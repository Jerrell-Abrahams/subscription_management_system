const test = require('node:test');
const assert = require('node:assert');
const { fromSubunit, occurredOn, toEntries } = require('./paystack');

// A realistic successful charge, shaped as GET /transaction returns it.
const txn = (over = {}) => ({
  id: 4099260516,
  status: 'success',
  reference: 're4lyvq3s3',
  amount: 40333,
  currency: 'ZAR',
  paid_at: '2026-08-19T14:20:35.000Z',
  created_at: '2026-08-19T14:20:20.000Z',
  channel: 'card',
  fees: 605,
  customer: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.co.za' },
  ...over,
});

// The hundredfold bug. Paystack quotes subunits, so 40333 is R403.33 -- booked verbatim it
// would report R40,333 of income from a R403 payment.
test('amounts convert from cents, not taken verbatim', () => {
  assert.strictEqual(fromSubunit(40333), 403.33);
  assert.strictEqual(fromSubunit(605), 6.05);
  assert.strictEqual(fromSubunit(0), 0);
  assert.strictEqual(fromSubunit(undefined), 0);
});

test('a payment lands as gross in plus the fee out', () => {
  assert.deepStrictEqual(toEntries([txn()]), [
    {
      occurred_on: '2026-08-19',
      direction: 'in',
      amount: 403.33,
      category: null,
      description: 'Jane Doe — re4lyvq3s3',
      source: 'paystack',
      external_id: '4099260516',
    },
    {
      occurred_on: '2026-08-19',
      direction: 'out',
      amount: 6.05,
      category: 'Paystack fees',
      description: 'Jane Doe — re4lyvq3s3',
      source: 'paystack',
      external_id: '4099260516:fee',
    },
  ]);
});

// Dedupe is what makes overlapping sync windows and a double-fired cron free.
test('gross and fee rows get distinct external ids', () => {
  const ids = toEntries([txn()]).map((r) => r.external_id);
  assert.strictEqual(new Set(ids).size, 2);
});

test('a zero fee produces no fee row', () => {
  assert.strictEqual(toEntries([txn({ fees: 0 })]).length, 1);
});

// Money never received must never reach the ledger.
test('only successful transactions are imported', () => {
  assert.deepStrictEqual(toEntries([txn({ status: 'failed' })]), []);
  assert.deepStrictEqual(toEntries([txn({ status: 'abandoned' })]), []);
});

// finance_entries has no currency column, so a foreign charge cannot be represented.
// Booking it as rand would invent money at whatever the exchange rate happens to be.
test('non-ZAR transactions are skipped rather than booked as rand', () => {
  assert.deepStrictEqual(toEntries([txn({ currency: 'NGN' })]), []);
  assert.strictEqual(toEntries([txn({ currency: 'ZAR' })]).length, 2);
});

// The bug this guards: 01:30 SAST on the 20th is 23:30 UTC on the 19th. Resolved in the
// server's timezone the payment books to the wrong day, and near a month boundary the
// wrong month.
test('paid_at resolves in SAST, not the server timezone', () => {
  assert.strictEqual(occurredOn('2026-08-19T23:30:00.000Z'), '2026-08-20');
  assert.strictEqual(occurredOn('2026-08-19T14:20:35.000Z'), '2026-08-19');
});

test('a bare date is taken verbatim, never round-tripped through a Date', () => {
  assert.strictEqual(occurredOn('2026-08-19'), '2026-08-19');
});

test('an unreadable date is rejected rather than guessed', () => {
  assert.strictEqual(occurredOn('not a date'), null);
  assert.strictEqual(occurredOn(''), null);
});

// Un-dedupable or empty rows would re-import on every single sync.
test('rows with no id, no date or no amount are skipped', () => {
  assert.deepStrictEqual(toEntries([txn({ id: null })]), []);
  assert.deepStrictEqual(toEntries([txn({ paid_at: 'nonsense', created_at: null })]), []);
  assert.deepStrictEqual(toEntries([txn({ amount: 0 })]), []);
});

test('falls back to email, then the reference, when there is no name', () => {
  assert.strictEqual(
    toEntries([txn({ customer: { email: 'jane@example.co.za' } })])[0].description,
    'jane@example.co.za — re4lyvq3s3'
  );
  assert.strictEqual(toEntries([txn({ customer: {} })])[0].description, 're4lyvq3s3');
});

test('no category is guessed on the income row, leaving it for you to file', () => {
  assert.strictEqual(toEntries([txn()])[0].category, null);
});

test('no transactions is not an error', () => {
  assert.deepStrictEqual(toEntries([]), []);
  assert.deepStrictEqual(toEntries(null), []);
});

// --- occurredOn: the timezone guard ------------------------------------------------

test('a timestamp with no timezone keeps its own date instead of the server\'s', () => {
  // 23:40 SAST on the 19th. Parsed as UTC on a Vercel host it becomes 01:40 SAST on the
  // 20th -- the wrong day, and at a month boundary the wrong month.
  assert.equal(occurredOn('2026-08-19 23:40:00'), '2026-08-19');
  assert.equal(occurredOn('2026-08-31T23:40:00'), '2026-08-31');

  // The two above pin the contract but cannot fail on a SAST dev machine: local parsing
  // lands on the same day by coincidence, which is exactly why the bug is invisible here
  // and only bites on Vercel. This one is deterministic in every timezone -- an unzoned
  // value must never reach new Date(), and a time new Date() rejects proves it did not.
  assert.equal(occurredOn('2026-08-19 25:99:99'), '2026-08-19');
});

test('a zoned timestamp is resolved in SAST, not UTC', () => {
  // 23:30Z on the 19th is 01:30 SAST on the 20th, and books to the 20th.
  assert.equal(occurredOn('2026-08-19T23:30:00.000Z'), '2026-08-20');
  assert.equal(occurredOn('2026-08-19T23:40:00+02:00'), '2026-08-19');
});

// --- fetchTransactions: the only looping code in the importer ----------------------

const http = require('node:http');
const { fetchTransactions, endOfDay } = require('./paystack');

// A stand-in Paystack. PAYSTACK_API_BASE is read per call precisely so this can exist.
async function withPaystack(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.PAYSTACK_API_BASE = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run();
  } finally {
    delete process.env.PAYSTACK_API_BASE;
    await new Promise((resolve) => server.close(resolve));
  }
}

const page = (data, pageCount) => JSON.stringify({ status: true, data, meta: { pageCount } });

test('the `to` bound covers the whole of its last day', async () => {
  // A bare to=2026-08-20 is midnight at the START of the 20th, so a sync run on the 20th
  // returns nothing paid that morning -- the exact case the Sync button is for.
  let seen;
  await withPaystack(
    (req, res) => {
      seen = new URL(req.url, 'http://x').searchParams;
      res.end(page([], 1));
    },
    () => fetchTransactions({ from: '2026-05-22', to: '2026-08-20', secretKey: 'sk_test' })
  );
  assert.equal(seen.get('to'), '2026-08-20T21:59:59.999Z'); // 23:59:59.999 SAST
  assert.equal(seen.get('from'), '2026-05-22', 'the from bound is left alone');
  assert.equal(endOfDay('2026-08-20T10:00:00Z'), '2026-08-20T10:00:00Z', 'a real timestamp passes through');
});

test('every page is followed, not just the first', async () => {
  const all = await withPaystack(
    (req, res) => {
      const p = new URL(req.url, 'http://x').searchParams.get('page');
      res.end(page([txn({ id: Number(p) })], 3));
    },
    () => fetchTransactions({ from: '2026-08-01', to: '2026-08-20', secretKey: 'sk_test' })
  );
  assert.deepEqual(all.map((t) => t.id), [1, 2, 3]);
});

test('running out of pages throws rather than returning a truncated set', async () => {
  // 2000 of 2400 rows returned as though that were the window is money vanishing silently.
  await assert.rejects(
    withPaystack(
      (req, res) => {
        const p = new URL(req.url, 'http://x').searchParams.get('page');
        res.end(page([txn({ id: Number(p) })], 9));
      },
      () => fetchTransactions({ from: '2026-08-01', to: '2026-08-20', secretKey: 'sk_test', maxPages: 3 })
    ),
    /9 pages .* stops at 3[\s\S]*Nothing was imported/
  );
});

test('status:false inside a 200 is an error, not an empty window', async () => {
  await assert.rejects(
    withPaystack(
      (req, res) => res.end(JSON.stringify({ status: false, message: 'Invalid key' })),
      () => fetchTransactions({ from: '2026-08-01', to: '2026-08-20', secretKey: 'sk_bad' })
    ),
    /Invalid key/
  );
});
