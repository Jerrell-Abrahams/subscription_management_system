// Pure maths for the Finance tab. No imports at all -- not react, not the supabase
// client, not import.meta.env -- because the root `node --test` picks up this file's
// neighbour and runs it in plain node. admin/package.json is "type": "module", so node
// loads both as ESM with no .mjs rename and no third copy of the money logic.
//
// Every date here is a 'YYYY-MM-DD' string straight off a Postgres `date` column, and is
// compared AS A STRING. Nothing in this file constructs a Date. That is not a shortcut,
// it is the correctness: zero-padded ISO dates sort lexicographically, so the comparison
// is exact in every timezone, while new Date('2026-08-31') is midnight UTC and lands on
// 30 August for anyone west of Greenwich. One Date in here re-opens that bug at every
// month boundary.

// PostgREST serialises numeric(10,2) as a string ('750.00'). Coerced here and nowhere
// else -- a missed Number() at a call site turns a sum into '750.00250.00'.
const amountOf = (entry) => Number(entry.amount) || 0;

// Floats accumulate error: 0.1 + 0.2 - 0.3 is 5.5e-17, which renders as "R -0,00" on a
// month that balanced exactly. Rounded once, on the way out.
const cents = (n) => Math.round(n * 100) / 100;

const monthOf = (entry) => entry.occurred_on.slice(0, 7);

// `month` is 'YYYY-MM', straight from the <input type="month">.
export function monthTotals(entries, month) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const e of entries) {
    if (monthOf(e) !== month) continue;
    if (e.direction === 'in') moneyIn += amountOf(e);
    else moneyOut += amountOf(e);
  }
  // net is rounded from the raw sums rather than from two already-rounded numbers.
  return { in: cents(moneyIn), out: cents(moneyOut), net: cents(moneyIn - moneyOut) };
}

export const UNCATEGORISED = 'Uncategorised';

// Spend only: money in is a payment received, not a kind of expense. Biggest first, so
// the chart reads top-down as "where it went".
export function spendByCategory(entries, month) {
  const totals = new Map();
  for (const e of entries) {
    if (e.direction !== 'out' || monthOf(e) !== month) continue;
    const key = e.category || UNCATEGORISED;
    totals.set(key, (totals.get(key) || 0) + amountOf(e));
  }
  return [...totals]
    .map(([category, amount]) => ({ category, amount: cents(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

// Balance as at a date, from a starting point the ledger cannot know.
//
// Entries dated BEFORE openingDate are excluded and COUNTED: the opening balance is the
// bank's own figure for that day, so it already contains everything earlier, and adding
// them double-counts. Counted rather than silently dropped, because otherwise you type
// last year's expenses in and quietly wonder why the balance never moves.
//
// Entries dated ON openingDate are included -- the opening balance is read at the START
// of that day, which is what the form has to say too or this is a coin flip.
//
// Future-dated rows are excluded from `balance` and included in `projected`, so a
// mistyped year surfaces as a gap between two numbers instead of moving the balance.
//
// balance is null, never 0, when no opening balance is set: on a money screen "zero" and
// "you haven't told me" must not look the same.
export function runningBalance(entries, { openingBalance, openingDate, asOf }) {
  if (openingBalance == null || openingBalance === '' || !openingDate) {
    return { balance: null, projected: null, ignoredBefore: 0, future: 0 };
  }
  const start = Number(openingBalance) || 0;
  let toDate = start;
  let all = start;
  let ignoredBefore = 0;
  let future = 0;

  for (const e of entries) {
    if (e.occurred_on < openingDate) {
      ignoredBefore += 1;
      continue;
    }
    const delta = e.direction === 'in' ? amountOf(e) : -amountOf(e);
    all += delta;
    if (e.occurred_on <= asOf) toDate += delta;
    else future += 1;
  }
  return { balance: cents(toDate), projected: cents(all), ignoredBefore, future };
}

// Everything ever typed, deduped, for the <datalist> behind the category box. Derived
// from the rows already in memory rather than a `select distinct`: the page holds every
// entry anyway (the running balance is cumulative, so there is no smaller query that
// works), and PostgREST has no DISTINCT without adding a view.
export function usedCategories(entries) {
  return [...new Set(entries.map((e) => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Free text plus a human is a case-drift machine: "Fuel" and "fuel" would sit as two bars
// on the same chart forever with nothing pointing at the mistake. Snaps to the spelling
// already in use. Blank becomes null, because the column rejects ''.
export function canonicalCategory(input, known) {
  const value = (input || '').trim();
  if (!value) return null;
  return (known || []).find((k) => k.toLowerCase() === value.toLowerCase()) || value;
}
