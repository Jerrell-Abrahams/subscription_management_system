const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const {
  CONTACT_METHODS,
  statusForOutcome,
  mapPlace,
  monthStartISO,
  FREE_SEARCHES_PER_MONTH,
  GOAL_SOURCES,
  GOAL_UNITS,
  goalWindow,
  sumAmounts,
} = require('../lib/leads');

const router = express.Router();
router.use(adminAuth);

// Only the fields the field mask below actually asks Google for. Widening the mask
// widens the bill (see the SKU note on POST /search), so the two lists stay in step.
const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
].join(',');

// Google's own ceilings for Text Search (New): 20 results per page, 60 across all
// pages. Asking for more than 20 means extra HTTP calls, and Google bills per call --
// so a 60-result search costs THREE against the monthly allowance, not one.
const PLACES_PAGE_SIZE = 20;
const PLACES_MAX_RESULTS = 60;

// locationBias.circle accepts a radius in metres, 0 to 50km (Google's ceiling).
const PLACES_MAX_RADIUS_M = 50000;
const DEFAULT_RADIUS_M = 10000;

// Raise this only to deliberately spend money past Google's free allowance -- it is
// the thing standing between a busy month and a bill.
const searchCap = () => Number(process.env.PLACES_SEARCH_CAP) || FREE_SEARCHES_PER_MONTH;

// Billable searches used so far this calendar month, matching how Google's free tier
// resets. Counted from our own log rather than Google's quota API: one fewer API to
// wire up, and this is the only thing calling the key.
//
// Throws rather than returning 0 when the log can't be read. A head-count against a
// MISSING table comes back as { error: null, count: null } -- so without the null check
// this quietly reports "0 used" forever and the cap never fires, which is the exact
// failure it exists to prevent.
async function searchesThisMonth() {
  const { count, error } = await supabase
    .from('lead_searches')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthStartISO());
  if (error || count === null) {
    throw new Error(
      'Search log unavailable, so spending cannot be capped. Run src/db/leads.sql to create the lead_searches table.'
    );
  }
  return count;
}

// Cheap read so the UI can show the counter without spending a search.
router.get('/usage', async (req, res) => {
  try {
    res.json({ used: await searchesThisMonth(), limit: searchCap() });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/search', async (req, res) => {
  const { location, industry, maxResults, latitude, longitude, radius } = req.body;

  // Either a typed place name or a pair of coordinates from the browser will do.
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  if (!industry) {
    return res.status(400).json({ error: 'industry is required' });
  }
  if (!location && !hasCoords) {
    return res.status(400).json({ error: 'a location or your coordinates are required' });
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY is not configured' });
  }

  const wanted = Math.min(
    PLACES_MAX_RESULTS,
    Math.max(1, Number(maxResults) || PLACES_PAGE_SIZE)
  );

  // Checked BEFORE the fetch: once the request leaves, it is billable. Failing closed
  // here is deliberate -- if usage can't be counted, it can't be capped, and an
  // uncountable search is exactly the one that turns into a surprise bill.
  let used;
  try {
    used = await searchesThisMonth();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
  const limit = searchCap();
  if (used >= limit) {
    return res.status(429).json({
      error:
        `Monthly free search limit reached (${used}/${limit}). It resets on the 1st. ` +
        'To keep searching this month you would start paying Google -- set PLACES_SEARCH_CAP higher if that is intended.',
      used,
      limit,
    });
  }

  // Pagination requires every parameter except pageToken to match the original request,
  // so the query is built once and only the token varies between pages.
  const query = { pageSize: PLACES_PAGE_SIZE };
  if (hasCoords) {
    // Bias rather than restrict: locationRestriction only takes a rectangle here, and a
    // hard boundary would drop a good lead sitting just past an arbitrary radius.
    query.textQuery = industry;
    query.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.min(PLACES_MAX_RADIUS_M, Math.max(1, Number(radius) || DEFAULT_RADIUS_M)),
      },
    };
  } else {
    query.textQuery = `${industry} in ${location}`;
  }

  // What gets written to the search log, so a coordinate search is still legible later.
  const searchLabel = hasCoords ? `Near ${lat.toFixed(4)}, ${lng.toFixed(4)}` : location;
  const collected = [];
  let pageToken = null;
  let pages = 0;
  let truncatedByCap = false;
  let logFailed = false;

  // Bounded by PAGES, not by results collected. Google often returns fewer than 20 on a
  // page (17 and 14 are typical), so looping until `wanted` results were gathered would
  // silently buy an extra page -- and the UI promises "20 results = 1 search".
  const maxPages = Math.ceil(wanted / PLACES_PAGE_SIZE);

  while (pages < maxPages) {
    // Re-checked each iteration: a multi-page search must not tip over the cap midway.
    if (used >= limit) {
      truncatedByCap = true;
      break;
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': `${PLACES_FIELD_MASK},nextPageToken`,
      },
      body: JSON.stringify(pageToken ? { ...query, pageToken } : query),
    });

    const body = await response.json();
    if (!response.ok) {
      // Google nests the human-readable reason (bad key, API not enabled, quota) here.
      // Only fail outright if nothing was retrieved -- once pages are paid for, partial
      // results beat throwing them away.
      if (pages === 0) {
        return res.status(response.status).json({ error: body.error?.message || 'Places search failed' });
      }
      break;
    }

    const page = (body.places || []).map(mapPlace).filter((r) => r.google_place_id);
    collected.push(...page);

    // Logged even when a page came back empty: Google billed for it either way, so the
    // counter has to reflect it or the cap under-counts and lets a bill through.
    const { error: logError } = await supabase
      .from('lead_searches')
      .insert({ location: searchLabel, industry, result_count: page.length });
    used += 1;
    pages += 1;

    // An unloggable call is an uncountable one, so stop buying pages rather than
    // spending further against a counter that has stopped tracking.
    if (logError) {
      logFailed = true;
      break;
    }

    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  const results = collected.slice(0, wanted);
  const usage = { used, limit };

  if (results.length === 0) {
    return res.json({ results: [], usage, pages, truncatedByCap, logFailed });
  }

  // Attach what's already known about each business. Since a lead is only created when a
  // call is logged, an existing row means "already called" -- and its status says what
  // came of it, which is more use on a re-search than a bare "seen this one" flag.
  const { data: existing } = await supabase
    .from('leads')
    .select('id, google_place_id, status, category')
    .in('google_place_id', results.map((r) => r.google_place_id));
  const known = new Map((existing || []).map((l) => [l.google_place_id, l]));

  // Most recent contact per known lead, so the row can say when it was last called.
  const lastContact = new Map();
  if (known.size > 0) {
    const { data: acts } = await supabase
      .from('lead_activities')
      .select('lead_id, occurred_at')
      .in('lead_id', [...known.values()].map((l) => l.id))
      .order('occurred_at', { ascending: false });
    // Ordered newest-first, so the first row seen for a lead is its latest contact.
    (acts || []).forEach((a) => {
      if (!lastContact.has(a.lead_id)) lastContact.set(a.lead_id, a.occurred_at);
    });
  }

  res.json({
    results: results.map((r) => {
      const lead = known.get(r.google_place_id);
      return {
        ...r,
        lead: lead
          ? {
              id: lead.id,
              status: lead.status,
              category: lead.category,
              lastContactedAt: lastContact.get(lead.id) || null,
            }
          : null,
      };
    }),
    usage,
    pages,
    truncatedByCap,
    logFailed,
  });
});

// Import a single search result and hand back the lead row, so the finder can open the
// Log Contact modal against it immediately. Unlike /import this returns the row whether
// it was just created or already existed -- calling a business you imported last week
// has to work the same as calling a brand new one.
router.post('/import-one', async (req, res) => {
  const { lead } = req.body;
  if (!lead || !lead.name) {
    return res.status(400).json({ error: 'lead with a name is required' });
  }

  if (lead.google_place_id) {
    const { data: existing } = await supabase
      .from('leads')
      .select('*')
      .eq('google_place_id', lead.google_place_id)
      .maybeSingle();
    // Deliberately not an upsert: overwriting would clobber a phone or email that was
    // corrected by hand since the first import.
    if (existing) {
      return res.json({ lead: existing, created: false });
    }
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      google_place_id: lead.google_place_id || null,
      name: lead.name,
      address: lead.address || null,
      phone: lead.phone || null,
      website: lead.website || null,
      rating: typeof lead.rating === 'number' ? lead.rating : null,
      review_count: typeof lead.review_count === 'number' ? lead.review_count : null,
      industry: lead.industry || null,
    })
    .select()
    .single();
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ lead: data, created: true });
});

router.post('/:id/activities', async (req, res) => {
  const { method, outcome, category, note, followUpDate } = req.body;

  const status = statusForOutcome(outcome);
  if (!status) {
    return res.status(400).json({ error: 'outcome is invalid' });
  }
  if (method && !CONTACT_METHODS.includes(method)) {
    return res.status(400).json({ error: 'method is invalid' });
  }
  if (!category) {
    return res.status(400).json({ error: 'category is required' });
  }
  // The follow-ups-due list is the whole point of the follow_up outcome, and it can't
  // show a lead with no date -- so refuse rather than silently dropping it off the list.
  if (outcome === 'follow_up' && !followUpDate) {
    return res.status(400).json({ error: 'followUpDate is required when the outcome is follow_up' });
  }

  const { error: activityError } = await supabase.from('lead_activities').insert({
    lead_id: req.params.id,
    method: method || 'cold_call',
    outcome,
    category,
    note: note || null,
  });
  if (activityError) {
    // 23503 = FK violation, i.e. no such lead.
    return res.status(activityError.code === '23503' ? 404 : 400).json({ error: activityError.message });
  }

  const patch = {
    status,
    follow_up_date: outcome === 'follow_up' ? followUpDate : null,
    category,
    updated_at: new Date().toISOString(),
  };

  // The note is kept in both places on purpose: on the activity as the record of THIS
  // call, and prepended to the lead so the latest context shows without digging through
  // history. Prepended rather than overwritten so earlier calls aren't lost.
  if (note && note.trim()) {
    const { data: current } = await supabase
      .from('leads')
      .select('notes')
      .eq('id', req.params.id)
      .maybeSingle();
    const stamped = `${new Date().toISOString().slice(0, 10)} — ${note.trim()}`;
    patch.notes = current?.notes ? `${stamped}\n${current.notes}` : stamped;
  }

  // ponytail: two sequential writes, not a transaction. If this update fails the
  // activity row survives with a stale lead status -- wrap both in a supabase.rpc
  // postgres function if that drift ever shows up in practice.
  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });
  }

  res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const allowed = ['status', 'email', 'phone', 'notes', 'category', 'follow_up_date', 'name'];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[key] = req.body[key] === '' ? null : req.body[key];
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    return res.status(error.code === 'PGRST116' ? 404 : 400).json({ error: error.message });
  }

  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ success: true });
});

// Progress is counted here rather than in the browser because a goal's window is
// arbitrary (a December deadline set in August), while the Leads page only loads the
// last 60 days of activity for its charts. Counting server-side sidesteps that limit.
async function currentForGoal(goal) {
  if (goal.source === 'manual') {
    return Number(goal.manual_current) || 0;
  }

  const { from, to } = goalWindow(goal);

  // The two money sources sum a column instead of counting rows, so they select the
  // amounts rather than using the head/count trick the branches below rely on.
  if (goal.source === 'revenue_received') {
    // occurred_on is a plain `date`, so it is compared against the window's date halves
    // -- handing it a timestamptz string matches nothing in Postgres.
    const { data } = await supabase
      .from('finance_entries')
      .select('amount')
      .eq('direction', 'in')
      .gte('occurred_on', from.slice(0, 10))
      .lte('occurred_on', to.slice(0, 10));
    return sumAmounts(data);
  }

  if (goal.source === 'invoices_paid') {
    // Dated on paid_at, not created_at or due_date: the goal is about money that
    // actually arrived inside the window, not invoices that happen to be owed.
    const { data } = await supabase
      .from('invoices')
      .select('amount')
      .eq('status', 'paid')
      .gte('paid_at', from)
      .lte('paid_at', to);
    return sumAmounts(data);
  }

  if (goal.source === 'leads_added') {
    let query = supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', from)
      .lte('created_at', to);
    if (goal.category) query = query.eq('category', goal.category);
    const { count } = await query;
    return count || 0;
  }

  let query = supabase
    .from('lead_activities')
    .select('*', { count: 'exact', head: true })
    .gte('occurred_at', from)
    .lte('occurred_at', to);
  if (goal.category) query = query.eq('category', goal.category);
  // Counted off the dated activity row, not leads.status -- status is current-state
  // with no record of WHEN it changed, so it can't honour a date window.
  if (goal.source === 'conversions') query = query.eq('outcome', 'converted');
  // Same rule as the Contacts KPIs on the dashboard: a no-answer is a dial, not a contact.
  if (goal.source === 'contacts') query = query.neq('outcome', 'no_answer');
  const { count } = await query;
  return count || 0;
}

router.get('/goals', async (req, res) => {
  let query = supabase.from('lead_goals').select('*').order('due_date', { nullsFirst: false });
  if (req.query.archived !== 'true') {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query;
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const goals = await Promise.all(
    data.map(async (goal) => ({ ...goal, current: await currentForGoal(goal) }))
  );
  res.json({ goals });
});

router.post('/goals', async (req, res) => {
  const { name, target, source, unit, category, startDate, dueDate, manualCurrent } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!(Number(target) > 0)) {
    return res.status(400).json({ error: 'target must be greater than 0' });
  }
  if (source && !GOAL_SOURCES.includes(source)) {
    return res.status(400).json({ error: 'source is invalid' });
  }
  if (unit && !GOAL_UNITS.includes(unit)) {
    return res.status(400).json({ error: 'unit is invalid' });
  }

  const { data, error } = await supabase
    .from('lead_goals')
    .insert({
      name: name.trim(),
      target: Number(target),
      source: source || 'manual',
      unit: unit || 'count',
      // Only the counted lead sources filter by category: finance entries use a free-text
      // vocabulary of their own and invoices have no category column at all, so a filter
      // carried over from a lead source would silently match nothing.
      category: category || null,
      manual_current: Number(manualCurrent) || 0,
      start_date: startDate || new Date().toISOString().slice(0, 10),
      due_date: dueDate || null,
    })
    .select()
    .single();
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ ...data, current: await currentForGoal(data) });
});

router.patch('/goals/:id', async (req, res) => {
  const allowed = ['name', 'target', 'source', 'unit', 'category', 'manual_current', 'start_date', 'due_date', 'archived_at'];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[key] = req.body[key] === '' ? null : req.body[key];
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }
  if (patch.source && !GOAL_SOURCES.includes(patch.source)) {
    return res.status(400).json({ error: 'source is invalid' });
  }
  if (patch.unit && !GOAL_UNITS.includes(patch.unit)) {
    return res.status(400).json({ error: 'unit is invalid' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('lead_goals')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    return res.status(error.code === 'PGRST116' ? 404 : 400).json({ error: error.message });
  }

  res.json({ ...data, current: await currentForGoal(data) });
});

router.delete('/goals/:id', async (req, res) => {
  const { error } = await supabase.from('lead_goals').delete().eq('id', req.params.id);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ success: true });
});

// Categories used to live on lead_goals; they get their own table now that goals are
// free-form (see src/db/leads_goals_v2.sql).
router.post('/categories', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const { data, error } = await supabase
    .from('lead_categories')
    .upsert({ name: name.trim() }, { onConflict: 'name' })
    .select()
    .single();
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json(data);
});

router.delete('/categories/:name', async (req, res) => {
  const { error } = await supabase.from('lead_categories').delete().eq('name', req.params.name);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ success: true });
});

module.exports = router;
