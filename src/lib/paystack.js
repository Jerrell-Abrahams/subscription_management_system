// Paystack transaction import for the Finance ledger.
//
// Vastly simpler than the Payfast integration this replaces: authentication is a bearer
// token, not an md5 of alphabetised headers, and the response is real JSON rather than a
// CSV blob served as text/html. There is no signature to get wrong.
//
// This imports MONEY IN. That is the whole reversal from Payfast, which was a buyer wallet
// and imported supplier spending -- read nothing here as symmetrical with that.
// Read per call, not once at load, so a test can point this at a local stand-in after the
// module is already required. fetchTransactions is the only looping, branching code in
// this file and the seam is what makes it testable at all.
const { sastDay } = require('./sast');

const apiBase = () => process.env.PAYSTACK_API_BASE || 'https://api.paystack.co';

// Paystack quotes every amount in the currency's SUBUNIT -- 'amount': 40333 is R403.33,
// never R40 333. Getting this wrong inflates the ledger a hundredfold, so it is the one
// conversion with its own test.
const fromSubunit = (cents) => Math.round(Number(cents) || 0) / 100;

// occurred_on is a plain `date`, and admin/src/lib/finance.js compares those AS STRINGS.
//
// A value that carries a timezone is genuinely parsed and then resolved in SAST ('en-CA'
// being the ISO-shaped locale) rather than in the server's UTC. This matters nightly: a
// payment at 01:30 SAST is still 23:30 the PREVIOUS day in UTC, and booking it to
// yesterday puts it in the wrong month twelve times a year.
function occurredOn(value) {
  const text = String(value ?? '').trim();
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/);
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(text);
  // Anything WITHOUT a timezone has nothing to resolve, so the date part is taken verbatim.
  // Handing it to new Date() instead reads it in the server's zone -- UTC on Vercel -- so
  // '2026-08-19 23:40:00' meaning 23:40 SAST comes back as the 20th, and on the 31st as the
  // wrong month. paid_at carries a Z today; this is the guard src/lib/payfast.js had before
  // it was replaced, and the ordering was the whole subtlety there too.
  if (iso && !zoned) return iso[0];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : sastDay(parsed);
}

// Who paid, in the words you'd want on a bank line. Falls back through name -> email ->
// the Paystack reference, because a row reading just 'Paystack' tells you nothing when
// you are trying to match it against an invoice.
function describe(t) {
  const c = t.customer || {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  const who = name || c.email || '';
  return [who, t.reference].filter(Boolean).join(' — ') || 'Paystack payment';
}

// One successful transaction becomes up to two ledger rows: the gross as 'in', and
// Paystack's cut as its own 'out' categorised "Paystack fees".
//
// Splitting the fee out rather than importing the net keeps what Paystack costs you
// visible on the spend chart. The known cost is stated in src/db/finance.sql's terms:
// "Balance today" then runs AHEAD of the real bank balance, because the gross is booked
// on the day of payment while Paystack settles the net a day or two later.
// Why toEntries would drop this transaction, or null if it wouldn't. Pulled out of the loop
// below so the sync route can report the ACTUAL reason a batch imported nothing, rather than
// guessing -- the filtering rule and the diagnostic can no longer say different things
// because they're the same function.
function skipReason(t) {
  // Belt and braces -- the list call already filters status=success, but an abandoned or
  // failed charge booked as income is money you never received.
  if (String(t.status || '').toLowerCase() !== 'success') return 'not a successful transaction';

  // finance_entries is ZAR only (no currency column at all), so a foreign-currency
  // transaction cannot be represented and is skipped rather than silently booked as rand.
  // Not expected on a South African account; the sync reports found-vs-imported so a skip
  // shows up as a mismatch instead of vanishing.
  if (t.currency && String(t.currency).toUpperCase() !== 'ZAR') return 'non-ZAR currency';

  // Unlike Payfast, a Paystack transaction id is unique per transaction -- there is no
  // second leg reusing it -- so the id alone is a sound dedupe key.
  if (!t.id) return 'missing transaction id';
  if (!occurredOn(t.paid_at || t.created_at)) return 'unparseable payment date';
  if (fromSubunit(t.amount) <= 0) return 'zero or negative amount';
  return null;
}

function toEntries(transactions) {
  const rows = [];
  for (const t of transactions || []) {
    if (skipReason(t)) continue;

    const on = occurredOn(t.paid_at || t.created_at);
    const gross = fromSubunit(t.amount);
    const description = describe(t);
    rows.push({
      occurred_on: on,
      direction: 'in',
      amount: gross,
      // No category guessed. Left blank for you to file, which is the whole point of
      // keeping categories editable on an imported row.
      category: null,
      description,
      source: 'paystack',
      external_id: String(t.id),
    });

    const fee = Math.abs(fromSubunit(t.fees));
    if (fee) {
      rows.push({
        occurred_on: on,
        direction: 'out',
        amount: fee,
        category: 'Paystack fees',
        description,
        source: 'paystack',
        external_id: `${t.id}:fee`,
      });
    }
  }
  return rows;
}

// Paystack pages at 50 by default and caps perPage at 100. Followed to the end rather than
// taking the first page: a 90-day first sync on a busy month would otherwise drop
// everything past row 100 with no error at all, which is the silent-money-loss failure
// this whole file exists to avoid.
// Paystack reads a bare `to=2026-08-20` as midnight at the START of that day, so a sync run
// today returns nothing paid today -- which is precisely what the Sync button exists for.
// Widened to the last instant of that day and sent as the Z timestamp the API documents.
// SAST is a fixed +02:00 (South Africa keeps no DST), so the offset is safe to hardcode.
const endOfDay = (day) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T23:59:59.999+02:00`).toISOString() : day;

async function fetchTransactions({ from, to, secretKey, maxPages = 20 }) {
  const all = [];
  const until = endOfDay(to);
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({ status: 'success', perPage: '100', page: String(page), from, to: until });
    const res = await fetch(`${apiBase()}/transaction?${query}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Paystack returned ${res.status}: ${text.slice(0, 200)}`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Paystack returned unreadable JSON: ${text.slice(0, 200)}`);
    }
    // status:false is Paystack reporting a problem inside a 200 -- an invalid key comes
    // back this way, so it has to be checked separately from res.ok.
    if (body.status === false) {
      throw new Error(`Paystack rejected the request: ${body.message || 'no reason given'}`);
    }
    const data = Array.isArray(body.data) ? body.data : [];
    all.push(...data);
    // `|| 1` here would silently stop after page one the moment meta.pageCount is ever
    // missing or malformed -- exactly the truncation this function exists to refuse to do
    // quietly. A pageCount we can't trust is treated as "not yet known to be the last
    // page", so paging only stops on a genuinely empty page or a confirmed pageCount --
    // otherwise it runs to maxPages and throws below, which is the loud failure this file
    // is supposed to prefer.
    const pageCount = Number(body.meta?.pageCount);
    const knownLastPage = Number.isFinite(pageCount) && pageCount > 0 && page >= pageCount;
    if (knownLastPage || !data.length) return all;
    // Out of pages before Paystack ran out of transactions. Thrown rather than returned
    // truncated: handing back 2000 of 2400 rows as though that were the whole window is
    // the silent money loss the comment above says this function exists to prevent, and
    // the caller cannot tell a capped result from a complete one.
    if (page === maxPages) {
      const pages = Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 'more';
      throw new Error(
        `Paystack has ${pages} pages of transactions between ${from} and ${to}, and this importer stops at ${maxPages}. ` +
          'Nothing was imported -- sync a shorter date range.'
      );
    }
  }
  return all;
}

module.exports = { fromSubunit, occurredOn, toEntries, skipReason, fetchTransactions, endOfDay };
