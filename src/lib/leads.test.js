const test = require('node:test');
const assert = require('node:assert');
const {
  statusForOutcome,
  mapPlace,
  CONTACT_METHODS,
  monthStartISO,
  goalWindow,
  goalPercent,
  GOAL_SOURCES,
  CURRENCY_GOAL_SOURCES,
  sumAmounts,
} = require('./leads');

test('lists the contact methods the DB check constraint accepts', () => {
  assert.deepStrictEqual(CONTACT_METHODS, ['cold_call', 'walk_in', 'cold_message', 'reach_out']);
});

test('maps each outcome to the status it should leave the lead in', () => {
  assert.strictEqual(statusForOutcome('no_answer'), 'contacted');
  assert.strictEqual(statusForOutcome('not_interested'), 'not_interested');
  assert.strictEqual(statusForOutcome('follow_up'), 'follow_up');
  assert.strictEqual(statusForOutcome('potential'), 'potential');
  assert.strictEqual(statusForOutcome('converted'), 'converted');
});

test('unknown outcome maps to undefined so the route can 400 rather than write garbage', () => {
  assert.strictEqual(statusForOutcome('maybe'), undefined);
  assert.strictEqual(statusForOutcome(undefined), undefined);
});

test('maps a full Places result to lead columns', () => {
  const place = {
    id: 'ChIJabc123',
    displayName: { text: "Joe's Plumbing" },
    formattedAddress: '12 Main St, Cape Town',
    nationalPhoneNumber: '021 555 0100',
    websiteUri: 'https://joesplumbing.example',
    rating: 4.5,
    userRatingCount: 120,
  };
  assert.deepStrictEqual(mapPlace(place), {
    google_place_id: 'ChIJabc123',
    name: "Joe's Plumbing",
    address: '12 Main St, Cape Town',
    phone: '021 555 0100',
    website: 'https://joesplumbing.example',
    rating: 4.5,
    review_count: 120,
  });
});

test('missing optional fields (no website, no rating yet) come through as null, not undefined', () => {
  const place = {
    id: 'ChIJnowebsite',
    displayName: { text: 'Corner Cafe' },
    formattedAddress: '5 High St',
  };
  const mapped = mapPlace(place);
  assert.strictEqual(mapped.website, null);
  assert.strictEqual(mapped.phone, null);
  assert.strictEqual(mapped.rating, null);
  assert.strictEqual(mapped.review_count, null);
});

test('missing displayName does not throw -- name falls back to an empty string', () => {
  const mapped = mapPlace({ id: 'ChIJnoname', formattedAddress: '5 High St' });
  assert.strictEqual(mapped.name, '');
});

test('a rating of 0 is kept, not coerced to null (0 is a valid rating, not "absent")', () => {
  const mapped = mapPlace({ id: 'x', rating: 0, userRatingCount: 0 });
  assert.strictEqual(mapped.rating, 0);
  assert.strictEqual(mapped.review_count, 0);
});

// The whole point of the search cap is that it resets when Google's free allowance
// does -- an off-by-one month here either bills real money or blocks a usable month.
test('month start is the 1st at midnight UTC, not the current instant', () => {
  assert.strictEqual(monthStartISO(new Date('2026-08-09T14:32:11Z')), '2026-08-01T00:00:00.000Z');
});

test('month start on the 1st does not roll back to the previous month', () => {
  assert.strictEqual(monthStartISO(new Date('2026-08-01T00:00:00Z')), '2026-08-01T00:00:00.000Z');
});

test('month start handles the January boundary without slipping a year', () => {
  assert.strictEqual(monthStartISO(new Date('2026-01-15T09:00:00Z')), '2026-01-01T00:00:00.000Z');
});

// An activity logged during the working day of the due date has to count -- a naive
// `<= due_date` against a timestamptz column cuts off at midnight and loses the day.
test('goal window covers the whole of the due date, not just its midnight', () => {
  const w = goalWindow(
    { start_date: '2026-08-03', due_date: '2026-08-09' },
    new Date('2026-08-20T00:00:00Z')
  );
  assert.strictEqual(w.from, '2026-08-03T00:00:00.000Z');
  assert.strictEqual(w.to, '2026-08-09T23:59:59.999Z');
});

test('an open-ended goal counts up to now', () => {
  const now = new Date('2026-08-09T10:00:00Z');
  const w = goalWindow({ start_date: '2026-08-01', due_date: null }, now);
  assert.strictEqual(w.to, now.toISOString());
});

// Otherwise an expired goal keeps climbing after its deadline and stops being a record
// of whether it was met.
test('a goal still running counts only up to now, not to its future due date', () => {
  const now = new Date('2026-08-09T10:00:00Z');
  const w = goalWindow({ start_date: '2026-08-01', due_date: '2026-12-31' }, now);
  assert.strictEqual(w.to, now.toISOString());
});

test('percentage clamps at 100 so an exceeded goal does not overflow its bar', () => {
  assert.strictEqual(goalPercent(150, 100), 100);
  assert.strictEqual(goalPercent(25, 100), 25);
  assert.strictEqual(goalPercent(0, 100), 0);
});

test('percentage of a zero or missing target is 0 rather than NaN/Infinity', () => {
  assert.strictEqual(goalPercent(5, 0), 0);
  assert.strictEqual(goalPercent(5, undefined), 0);
});

// Every source here must also be in the check constraint in src/db/leads_goals_money.sql;
// a value this list accepts but the DB rejects fails at insert time with a raw Postgres
// error rather than the route's 400.
test('goal sources match what the DB check constraint allows', () => {
  assert.deepStrictEqual(GOAL_SOURCES, [
    'manual',
    'contacts',
    'conversions',
    'leads_added',
    'revenue_received',
    'invoices_paid',
  ]);
});

test('the money sources are the two that sum rands, and manual is not one of them', () => {
  assert.deepStrictEqual(CURRENCY_GOAL_SOURCES, ['revenue_received', 'invoices_paid']);
  // manual is deliberately absent: a manual goal can still be currency, but that is the
  // unit column's decision, not the source's.
  assert.ok(!CURRENCY_GOAL_SOURCES.includes('manual'));
});

test('summing amounts rounds to cents instead of leaking float drift', () => {
  // 0.1 + 0.2 = 0.30000000000000004 in IEEE754; a goal must not read R0.30000000000000004.
  assert.strictEqual(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.strictEqual(sumAmounts([{ amount: '1250.50' }, { amount: '749.50' }]), 2000);
});

test('summing an empty or absent result set is 0, not NaN', () => {
  assert.strictEqual(sumAmounts([]), 0);
  assert.strictEqual(sumAmounts(null), 0);
  assert.strictEqual(sumAmounts(undefined), 0);
});

// invoices.amount is nullable -- "null on a first draft with no prior invoice to copy",
// per invoices.sql -- so a null must not turn the whole goal into NaN.
test('a null amount contributes 0 rather than poisoning the sum', () => {
  assert.strictEqual(sumAmounts([{ amount: 500 }, { amount: null }, { amount: 250 }]), 750);
});

// finance_entries.occurred_on is a plain `date`, so the route slices the window to
// YYYY-MM-DD before querying it. Pin that the slice lands on the right days.
test('a money goal window slices to whole dates for the date-typed ledger column', () => {
  const w = goalWindow(
    { start_date: '2026-07-01', due_date: '2026-09-30' },
    new Date('2026-12-01T00:00:00Z')
  );
  assert.strictEqual(w.from.slice(0, 10), '2026-07-01');
  assert.strictEqual(w.to.slice(0, 10), '2026-09-30');
});

// Money targets are decimal where every count target was an integer, so the percent
// helper had never actually been run on fractional input.
test('percentage works on decimal rand amounts, not just whole counts', () => {
  assert.strictEqual(goalPercent(7250.5, 15000), 48);
  assert.strictEqual(goalPercent(19999.99, 20000), 100);
  assert.strictEqual(goalPercent(0.5, 20000), 0);
});
