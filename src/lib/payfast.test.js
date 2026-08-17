const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { signature, parseHistory, occurredOn, toEntries } = require('./payfast');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// The signature is the entire authentication story, and every way it goes wrong returns
// the same opaque "signature does not match". These assert the exact string being hashed.
test('signature hashes alphabetised key=value pairs with the passphrase folded in', () => {
  assert.strictEqual(signature({ b: '2', a: '1' }, 'secret'), md5('a=1&b=2&passphrase=secret'));
});

test('key order in the caller cannot change the signature', () => {
  assert.strictEqual(signature({ a: '1', b: '2' }, 's'), signature({ b: '2', a: '1' }, 's'));
});

// %20 here is the difference between a working call and an afternoon of debugging.
test('spaces encode as + rather than %20', () => {
  assert.strictEqual(signature({ a: 'x y' }, 's'), md5('a=x+y&passphrase=s'));
});

test('the passphrase changes the signature', () => {
  assert.notStrictEqual(signature({ a: '1' }, 'one'), signature({ a: '1' }, 'two'));
});

// Verbatim from the live account on 2026-08-17: the real header row, the real quoting, and
// the entire two-year history. Both legs share PF Payment ID 320759399, which is the fact
// the external_id has to survive.
const LIVE_CSV = [
  'Date,Type,Sign,Party,Name,Description,Currency,"Funding Type","Batch ID",Gross,Fee,Net,Balance,"M Payment ID","PF Payment ID"',
  '"2026-08-11 17:58:49",TOPUP,CREDIT,"My Credit Card","Topup from Credit Card",,ZAR,CC,,49.00,0.00,49.00,49.00,1763748,320759399',
  '"2026-08-11 17:58:50",FUNDS_SENT,DEBIT,"Host Africa (Pty) Ltd","HOSTAFRICA purchase, Invoice ID #1763748","HOSTAFRICA - Invoice ID #1763748",ZAR,CC,,-49.00,0.00,-49.00,0.00,1763748,320759399',
].join('\n');

// The endpoint answers with a bare CSV body and content-type text/html -- no JSON envelope
// at all -- so this is the shape that actually has to work.
test('the live response maps to one expense, not income plus an expense', () => {
  assert.deepStrictEqual(toEntries(parseHistory(LIVE_CSV)), [
    {
      occurred_on: '2026-08-11',
      direction: 'out',
      amount: 49,
      category: null,
      description: 'Host Africa (Pty) Ltd — HOSTAFRICA - Invoice ID #1763748',
      source: 'payfast',
      external_id: '320759399:FUNDS_SENT:DEBIT',
    },
  ]);
});

// The bug this locks down: a topup is a credit card funding the wallet. Booked as 'in' it
// invents R49 of revenue, and the purchase it pays for books as 'out' as well -- so one
// hosting bill reads as a day that both earned and spent R49.
test('a topup is a transfer between own accounts, not income', () => {
  assert.deepStrictEqual(toEntries([{ Date: '2026-08-11', Type: 'TOPUP', Sign: 'CREDIT', 'PF Payment ID': 'A', Gross: '49.00' }]), []);
});

// Payfast reuses one PF Payment ID across both legs. Keyed on the id alone the unique index
// silently swallows one of the two rows.
test('both legs of one payment id survive as distinct rows', () => {
  const ids = toEntries([
    { Date: '2026-08-11', Type: 'FUNDS_SENT', Sign: 'DEBIT', 'PF Payment ID': '99', Gross: '-49.00' },
    { Date: '2026-08-11', Type: 'REFUND', Sign: 'CREDIT', 'PF Payment ID': '99', Gross: '49.00' },
  ]).map((r) => r.external_id);
  assert.deepStrictEqual(ids, ['99:FUNDS_SENT:DEBIT', '99:REFUND:CREDIT']);
  assert.strictEqual(new Set(ids).size, 2);
});

test('Sign decides direction, and outranks the gross sign when they disagree', () => {
  const [row] = toEntries([{ date: '2026-08-11', type: 'X', sign: 'DEBIT', id: 'A', gross: '49.00' }]);
  assert.deepStrictEqual([row.direction, row.amount], ['out', 49]);
});

// A response without the column still has to land somewhere sane.
test('falls back to the gross sign when Sign is absent', () => {
  assert.strictEqual(toEntries([{ date: '2026-08-11', id: 'A', gross: '-250.00' }])[0].direction, 'out');
  assert.strictEqual(toEntries([{ date: '2026-08-11', id: 'A', gross: '250.00' }])[0].direction, 'in');
});

// An 'out' is not necessarily a refund -- the only one in this account is a hosting bill.
test('no category is guessed, leaving it for you to fill in', () => {
  assert.strictEqual(toEntries([{ date: '2026-08-11', id: 'A', gross: '-250.00' }])[0].category, null);
});

test('reads the JSON-array shape too', () => {
  const rows = toEntries(
    parseHistory(JSON.stringify({ data: { response: [{ date: '2026-08-17', id: 'X', gross: '100.00' }] } }))
  );
  assert.deepStrictEqual(rows.map((r) => [r.direction, r.amount, r.external_id]), [['in', 100, 'X:NA:NA']]);
});

test('strips the currency symbol and thousands separator', () => {
  assert.strictEqual(toEntries([{ date: '2026-08-17', id: 'A', gross: 'R 1,234.56' }])[0].amount, 1234.56);
});

// Dedupe is what makes overlapping sync windows and a double-fired cron free.
test('gross and fee rows get distinct external ids', () => {
  const ids = toEntries([{ date: '2026-08-17', id: 'A', type: 'T', sign: 'CREDIT', gross: '100', fee: '5' }]).map(
    (r) => r.external_id
  );
  assert.deepStrictEqual(ids, ['A:T:CREDIT', 'A:T:CREDIT:fee']);
});

test('a zero fee produces no fee row', () => {
  assert.strictEqual(toEntries([{ date: '2026-08-17', id: 'A', gross: '100', fee: '0.00' }]).length, 1);
});

// Un-dedupable rows would re-import on every single sync.
test('rows with no id or no date are skipped', () => {
  assert.deepStrictEqual(toEntries([{ date: '2026-08-17', gross: '100' }]), []);
  assert.deepStrictEqual(toEntries([{ id: 'A', gross: '100' }]), []);
});

// The bug this guards: new Date('2026-08-17') is UTC midnight, and formatting it back in
// any western timezone returns the 16th. The string prefix must survive untouched.
test('a YYYY-MM-DD date is taken verbatim, never round-tripped through a Date', () => {
  assert.strictEqual(occurredOn('2026-08-17'), '2026-08-17');
  assert.strictEqual(occurredOn('2026-08-17 23:45:00'), '2026-08-17');
});

// 00:30 SAST is still the 17th in Johannesburg, though it is the 16th in UTC.
test('other date shapes are resolved in SAST, not the server timezone', () => {
  assert.strictEqual(occurredOn('2026-08-16T22:30:00Z'), '2026-08-17');
});

test('an unreadable date is rejected rather than guessed', () => {
  assert.strictEqual(occurredOn('not a date'), null);
  assert.strictEqual(occurredOn(''), null);
});

test('no transactions is not an error', () => {
  assert.deepStrictEqual(toEntries(parseHistory(JSON.stringify({ data: { response: '' } }))), []);
  assert.deepStrictEqual(toEntries(null), []);
});
