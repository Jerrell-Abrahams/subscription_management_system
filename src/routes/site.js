const express = require('express');
const supabase = require('../config/supabase');
const { isActive, normalizeDomain } = require('../lib/websiteAccess');

const router = express.Router();

// Public + unauthenticated: called by each customer site's edge middleware on the
// visitor's behalf. Returns only { active, reason } for a domain -- nothing sensitive.
// Mounted with permissive CORS + a short cache in server.js.
router.get('/status', async (req, res) => {
  const domain = normalizeDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'domain query parameter is required' });
  }

  const { data: website, error } = await supabase
    .from('websites')
    .select('kind, subscriptions(status, current_period_end)')
    .ilike('domain', domain) // no % / _ in a hostname, so this is a case-insensitive exact match
    .maybeSingle();

  if (error) {
    // On our own error, fail open rather than dark every site at once.
    // ponytail: fail-open on lookup error; a status-API outage must not take paying sites down.
    return res.json({ active: true, reason: 'unavailable' });
  }

  // ponytail: fail-open on unknown/unregistered domains -- a site is only ever
  // blocked after you register it here and suspend it.
  if (!website) {
    return res.json({ active: true, reason: 'unregistered' });
  }

  // Only a client site is gated on billing. Demos and our own properties carry no
  // subscription, and isActive(null) is false -- without this they would go from
  // "unregistered, fail open" to "registered, permanently suspended" the moment they were
  // listed in the Websites tab.
  if (website.kind !== 'client') {
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ active: true, reason: website.kind });
  }

  const active = isActive(website.subscriptions);
  res.set('Cache-Control', 'public, max-age=60'); // middleware/edge cache it; not hit per pageview
  res.json({ active, reason: active ? 'active' : 'suspended' });
});

module.exports = router;
