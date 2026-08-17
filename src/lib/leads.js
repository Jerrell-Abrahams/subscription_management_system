// Pure helpers for the leads/outreach feature. Kept dependency-free (no supabase, no
// fetch) so they run under node:test the same way src/lib/modules.js does.

// Contact methods the outreach log recognises, mirrored by the DB check constraint on
// lead_activities.method. The admin UI duplicates the labels (can't import CommonJS
// into the Vite bundle), same situation as PRODUCT_MODULES today.
const CONTACT_METHODS = ['cold_call', 'walk_in', 'cold_message', 'reach_out'];

// What a lead's status becomes after a logged activity, keyed by outcome. Deliberately
// a flat map rather than a state machine (see the ponytail note on subscription status
// transitions in src/routes/admin.js) -- add transition rules only if a real workflow
// need shows up.
const STATUS_FOR_OUTCOME = {
  no_answer: 'contacted',
  not_interested: 'not_interested',
  follow_up: 'follow_up',
  potential: 'potential',
  converted: 'converted',
};

function statusForOutcome(outcome) {
  return STATUS_FOR_OUTCOME[outcome];
}

// Maps one Places API (New) Text Search result to the columns leads.sql expects.
// Every field but place.id is optional in Places' response, so this stays null-safe
// rather than trusting the shape.
function mapPlace(place) {
  return {
    google_place_id: place?.id || null,
    name: place?.displayName?.text || '',
    address: place?.formattedAddress || null,
    phone: place?.nationalPhoneNumber || null,
    website: place?.websiteUri || null,
    rating: typeof place?.rating === 'number' ? place.rating : null,
    review_count: typeof place?.userRatingCount === 'number' ? place.userRatingCount : null,
  };
}

// Google's per-SKU free allowance resets at the start of each calendar month (UTC).
// Our field mask asks for phone/website/rating, which are Enterprise-tier fields, so
// the relevant allowance is Text Search Enterprise: 1,000 calls/month.
const FREE_SEARCHES_PER_MONTH = 1000;

function monthStartISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// How a goal's progress is measured. 'manual' is a number the user maintains; the rest
// are derived from rows we already store, so they cannot drift out of step with reality.
//
// The two money sources are separate on purpose: marking an invoice paid does not write
// a finance entry, so the same rand can appear in both tables and a goal has to pick one.
// revenue_received is everything that landed (including once-off work with no
// subscription); invoices_paid is subscription revenue only, but updates instantly.
const GOAL_SOURCES = [
  'manual',
  'contacts',
  'conversions',
  'leads_added',
  'revenue_received',
  'invoices_paid',
];

// Sources that sum a rand amount rather than counting rows. Used to default a goal's
// unit, not to decide it -- unit is its own column so a *manual* goal can be money too.
const CURRENCY_GOAL_SOURCES = ['revenue_received', 'invoices_paid'];

const GOAL_UNITS = ['count', 'currency'];

// The timestamp range a counted goal draws from. Dates in the DB are plain `date`
// columns but activities are timestamptz, so both ends are widened to cover the whole
// day -- an activity logged at 14:00 on the due date must still count.
//
// Counting stops at due_date rather than running to now(): an expired goal should keep
// the number it finished on, not keep climbing after its deadline passed.
function goalWindow(goal, now = new Date()) {
  const from = `${goal.start_date}T00:00:00.000Z`;
  const end = goal.due_date ? new Date(`${goal.due_date}T23:59:59.999Z`) : now;
  return { from, to: (end < now ? end : now).toISOString() };
}

function goalPercent(current, target) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

// Sums a numeric column over rows the caller already filtered. Money columns are
// numeric(10,2), which supabase-js hands back as JS numbers, so this adds in floating
// point -- rounded to cents at the end because 0.1 + 0.2 style drift is visible once a
// few hundred entries stack up, and a goal reading R19999.999999 is nonsense.
function sumAmounts(rows) {
  const total = (rows || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  return Math.round(total * 100) / 100;
}

module.exports = {
  CONTACT_METHODS,
  statusForOutcome,
  mapPlace,
  monthStartISO,
  FREE_SEARCHES_PER_MONTH,
  GOAL_SOURCES,
  CURRENCY_GOAL_SOURCES,
  GOAL_UNITS,
  goalWindow,
  goalPercent,
  sumAmounts,
};
