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

// Server-to-server only: called by the restaurant platform, never by a browser. Guarded by a
// shared secret rather than a session, because there is no user in this request -- the restaurant
// API is asking on its own behalf about a subscription its own database cannot see.
router.get('/subscription', async (req, res) => {
  // Explicit unset check first. Without it an unset PLATFORM_SECRET compares undefined to a
  // missing header, matches, and the endpoint is wide open the moment someone forgets an env var.
  const expected = process.env.PLATFORM_SECRET;
  if (!expected || req.headers['x-platform-secret'] !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id query parameter is required' });

  const { data: subscription, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('id', id)
    .maybeSingle();

  // ponytail: fail open on our own error, matching /status directly above -- an outage here must
  // not turn every restaurant console read-only at once.
  if (error) return res.json({ active: true, reason: 'unavailable' });

  // ponytail: fail open on an unknown id too, and for the same reason /status fails open on an
  // unregistered domain: a restaurant is only ever blocked after its subscription is correctly
  // wired here AND has lapsed. A typo'd id must not lock a paying customer out of their console.
  if (!subscription) return res.json({ active: true, reason: 'unknown' });

  const active = isActive(subscription);
  res.set('Cache-Control', 'private, max-age=60'); // the caller caches for 5 minutes as well
  res.json({ active, reason: subscription.status });
});

module.exports = router;
