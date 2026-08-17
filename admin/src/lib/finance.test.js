// Run by the root `npm test` (`node --test`), which walks into admin/ and loads this as
// ESM because admin/package.json is "type": "module". Nothing here imports react or the
// supabase client, so it needs no bundler and no mocks -- same arrangement as src/lib.
import test from 'node:test';
import assert from 'node:assert';
import {
  monthTotals,
  spendByCategory,
  runningBalance,
  usedCategories,
  canonicalCategory,
  UNCATEGORISED,
} from './finance.js';

// Amounts are strings on purpose throughout: numeric(10,2) arrives from PostgREST as
// '750.00', and a fixture of real numbers would pass while production concatenated.
const entry = (occurred_on, direction, amount, category = null) => ({
  occurred_on,
  direction,
  amount,
  category,
});

test('money in and out are summed from the strings PostgREST returns for numeric columns', () => {
  const entries = [
    entry('2026-08-03', 'in', '750.00'),
    entry('2026-08-05', 'out', '210.50'),
    entry('2026-08-09', 'in', '1250.00'),
  ];
  const totals = monthTotals(entries, '2026-08');
  assert.strictEqual(totals.in, 2000);
  assert.strictEqual(totals.out, 210.5);
  assert.strictEqual(totals.net, 1789.5);
});

test('a month with nothing in it reports zero in, zero out, zero net', () => {
  assert.deepStrictEqual(monthTotals([entry('2026-08-03', 'in', '750.00')], '2026-09'), {
    in: 0,
    out: 0,
    net: 0,
  });
});

test('a month is selected by date prefix, so 31 August and 1 September never land in the wrong month', () => {
  // The whole reason this file never constructs a Date: new Date('2026-08-31') is
  // midnight UTC and reads as 30 August west of Greenwich. String prefixes cannot slip.
  const entries = [
    entry('2026-07-31', 'out', '100.00'),
    entry('2026-08-01', 'out', '10.00'),
    entry('2026-08-31', 'out', '20.00'),
    entry('2026-09-01', 'out', '100.00'),
  ];
  assert.strictEqual(monthTotals(entries, '2026-08').out, 30);
});

test('a month where money in and out match exactly nets to zero, not to a floating point crumb', () => {
  // 0.1 + 0.2 - 0.3 is 5.5e-17 in binary floating point, which formats as "R -0,00".
  const entries = [
    entry('2026-08-01', 'in', '0.10'),
    entry('2026-08-02', 'in', '0.20'),
    entry('2026-08-03', 'out', '0.30'),
  ];
  assert.strictEqual(monthTotals(entries, '2026-08').net, 0);
});

test('spend by category totals only money out, biggest first', () => {
  const entries = [
    entry('2026-08-01', 'out', '210.00', 'Hosting'),
    entry('2026-08-02', 'out', '400.00', 'Fuel'),
    entry('2026-08-03', 'out', '95.00', 'Hosting'),
    // Money received is not a kind of spend, however it is categorised.
    entry('2026-08-04', 'in', '5000.00', 'Fuel'),
  ];
  assert.deepStrictEqual(spendByCategory(entries, '2026-08'), [
    { category: 'Fuel', amount: 400 },
    { category: 'Hosting', amount: 305 },
  ]);
});

test('entries with no category are grouped as Uncategorised rather than dropped', () => {
  const entries = [entry('2026-08-01', 'out', '80.00'), entry('2026-08-02', 'out', '20.00', 'Fuel')];
  assert.deepStrictEqual(spendByCategory(entries, '2026-08'), [
    { category: UNCATEGORISED, amount: 80 },
    { category: 'Fuel', amount: 20 },
  ]);
});

test('the running balance starts from the opening balance and adds every entry on or after its date', () => {
  const entries = [entry('2026-08-04', 'out', '250.50'), entry('2026-08-06', 'in', '750.00')];
  const { balance, ignoredBefore, future } = runningBalance(entries, {
    // A string, as app_settings.opening_balance actually arrives.
    openingBalance: '1000.00',
    openingDate: '2026-08-01',
    asOf: '2026-08-12',
  });
  assert.strictEqual(balance, 1499.5);
  assert.strictEqual(ignoredBefore, 0);
  assert.strictEqual(future, 0);
});

test('an entry dated on the opening balance date counts, because the balance is read at the start of that day', () => {
  // The form says "balance at the START of this day". If that sentence changes, so must
  // this test -- the two are one decision.
  const { balance, ignoredBefore } = runningBalance([entry('2026-08-01', 'out', '100.00')], {
    openingBalance: 1000,
    openingDate: '2026-08-01',
    asOf: '2026-08-12',
  });
  assert.strictEqual(balance, 900);
  assert.strictEqual(ignoredBefore, 0);
});

test('entries dated before the opening balance date are reported as ignored, not silently counted', () => {
  const entries = [
    entry('2026-07-20', 'out', '500.00'),
    entry('2026-07-31', 'in', '9000.00'),
    entry('2026-08-02', 'out', '100.00'),
  ];
  const { balance, ignoredBefore } = runningBalance(entries, {
    openingBalance: 1000,
    openingDate: '2026-08-01',
    asOf: '2026-08-12',
  });
  // The bank's opening figure already contains July, so neither July row moves it.
  assert.strictEqual(balance, 900);
  assert.strictEqual(ignoredBefore, 2);
});

test("future-dated entries stay out of today's balance and show up in the projected one", () => {
  const entries = [entry('2026-08-02', 'out', '100.00'), entry('2026-09-01', 'out', '250.00')];
  const { balance, projected, future } = runningBalance(entries, {
    openingBalance: 1000,
    openingDate: '2026-08-01',
    asOf: '2026-08-12',
  });
  assert.strictEqual(balance, 900);
  assert.strictEqual(projected, 650);
  assert.strictEqual(future, 1);
});

test('without an opening balance the running balance is null rather than zero', () => {
  // "Zero" and "you haven't told me yet" must not render the same on a money screen.
  const entries = [entry('2026-08-02', 'out', '100.00')];
  assert.strictEqual(runningBalance(entries, { openingDate: '2026-08-01', asOf: '2026-08-12' }).balance, null);
  assert.strictEqual(runningBalance(entries, { openingBalance: 1000, asOf: '2026-08-12' }).balance, null);
});

test('the category list offers every category ever used, once, in alphabetical order', () => {
  const entries = [
    entry('2026-08-01', 'out', '10.00', 'Hosting'),
    entry('2026-08-02', 'out', '10.00', 'Fuel'),
    entry('2026-08-03', 'out', '10.00', 'Hosting'),
    entry('2026-08-04', 'out', '10.00'),
  ];
  assert.deepStrictEqual(usedCategories(entries), ['Fuel', 'Hosting']);
});

test('a category typed in a different case snaps to the spelling already in use', () => {
  // Otherwise "Fuel" and "fuel" sit as two bars on the same chart forever.
  assert.strictEqual(canonicalCategory('fuel', ['Fuel', 'Hosting']), 'Fuel');
  assert.strictEqual(canonicalCategory('  HOSTING ', ['Fuel', 'Hosting']), 'Hosting');
  assert.strictEqual(canonicalCategory('Stationery', ['Fuel']), 'Stationery');
});

test('a blank or whitespace category is stored as nothing rather than an empty string', () => {
  // The column is `check (category is null or category <> '')`, so '' would be rejected
  // by Postgres -- and a blank bucket beside null would split the chart in two.
  assert.strictEqual(canonicalCategory('   ', ['Fuel']), null);
  assert.strictEqual(canonicalCategory('', ['Fuel']), null);
  assert.strictEqual(canonicalCategory(undefined, ['Fuel']), null);
});
