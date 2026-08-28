const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const { nextPeriodEnd } = require('../lib/renewal');
const { normalizeDomain } = require('../lib/websiteAccess');
const { provisionRestaurant } = require('../lib/restaurantProvision');

const router = express.Router();
router.use(adminAuth);

router.post('/users', async (req, res) => {
  const { email, password, fullName, phone, companyName, billingAddress } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const { data: profile, error: profileError } = await supabase
    .from('app_users')
    // company_name/billing_address are the invoice Bill To block (src/db/invoices.sql).
    // Both optional -- they simply don't render on the PDF when blank.
    .insert({
      id: created.user.id,
      email,
      full_name: fullName || null,
      phone: phone || null,
      company_name: companyName || null,
      billing_address: billingAddress || null,
    })
    .select()
    .single();
  if (profileError) {
    return res.status(500).json({ error: profileError.message });
  }

  // No welcome email: the sending domain isn't verified, so this used to fail into a
  // console nobody reads and every customer's login quietly never arrived. The password is
  // on the admin's screen at this point -- it goes to the customer the same way the sale
  // did, by hand.
  res.status(201).json(profile);
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ error: "Can't delete your own account" });
  }

  const { error } = await supabase.auth.admin.deleteUser(req.params.id);
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ success: true });
});

router.patch('/users/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password });
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ success: true });
});

router.post('/subscriptions', async (req, res) => {
  const { userId, productId, billingInterval, maxActivations, currentPeriodEnd } = req.body;
  if (!userId || !productId) {
    return res.status(400).json({ error: 'userId and productId are required' });
  }

  const interval = billingInterval === 'yearly' ? 'yearly' : 'monthly';
  const maxAct = Number(maxActivations) > 0 ? Number(maxActivations) : 1;
  let periodEnd;
  if (currentPeriodEnd) {
    periodEnd = new Date(currentPeriodEnd);
  } else {
    periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + (interval === 'yearly' ? 12 : 1));
  }
  if (Number.isNaN(periodEnd.getTime())) {
    return res.status(400).json({ error: 'currentPeriodEnd is invalid' });
  }

  const { data: subscription, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      product_id: productId,
      billing_interval: interval,
      max_activations: maxAct,
      status: 'pending',
      current_period_end: periodEnd.toISOString(),
    })
    .select('*, app_users(email), products(name)')
    .single();
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json(subscription);
});

// Second half of creating a "restaurant" subscription: the owner's real login lives in a
// different Supabase project entirely, so it cannot be created from the browser the way
// createUser above does -- RESTAURANT_API_SECRET must stay server-side. Kept as its own call
// (rather than folded into POST /subscriptions) because the restaurant repo's endpoint is
// idempotent on subscriptionId, so the console can retry exactly this step on failure without
// risking a second app_user or a second subscription.
router.post('/subscriptions/:id/provision-restaurant', async (req, res) => {
  const { email, password, fullName, restaurantName, slug, googlePlaceId } = req.body;
  if (!email || !password || !restaurantName) {
    return res.status(400).json({ error: 'email, password and restaurantName are required' });
  }

  try {
    const restaurant = await provisionRestaurant({
      subscriptionId: req.params.id,
      email,
      password,
      fullName,
      restaurantName,
      slug,
      googlePlaceId,
    });
    res.status(201).json(restaurant);
  } catch (err) {
    console.error('[admin] restaurant provisioning failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ponytail: no transition-legality state machine beyond the DB's own status
// check constraint - add one if invalid transitions become a real support issue.
function setStatusHandler(status) {
  return async (req, res) => {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });
    }
    res.json(data);
  };
}
// Field-level corrections: reassign an owner, fix a billing interval, adjust a period end,
// set a status straight. Distinct from the transition routes below -- those carry meaning
// ("renew" also extends the period), this one only writes what you hand it. Mirrors the
// check constraints in src/db/schema.sql so a bad value is a 400 here rather than a raw
// Postgres error at the client.
const SUB_STATUSES = ['pending', 'active', 'past_due', 'canceled', 'expired', 'revoked'];

router.patch('/subscriptions/:id', async (req, res) => {
  const { userId, status, billingInterval, currentPeriodEnd } = req.body;
  const patch = {};

  if (userId !== undefined) patch.user_id = userId;
  if (status !== undefined) {
    if (!SUB_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${SUB_STATUSES.join(', ')}` });
    }
    patch.status = status;
  }
  if (billingInterval !== undefined) {
    if (!['monthly', 'yearly'].includes(billingInterval)) {
      return res.status(400).json({ error: 'billingInterval must be monthly or yearly' });
    }
    patch.billing_interval = billingInterval;
  }
  if (currentPeriodEnd !== undefined) {
    const end = new Date(currentPeriodEnd);
    if (Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: 'currentPeriodEnd is invalid' });
    }
    patch.current_period_end = end.toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('subscriptions')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    // 23503 = user_id pointing at an app_users row that isn't there.
    if (error.code === '23503') return res.status(400).json({ error: 'That owner does not exist' });
    return res.status(error.code === 'PGRST116' ? 404 : 400).json({ error: error.message });
  }

  res.json(data);
});

router.patch('/subscriptions/:id/cancel', setStatusHandler('canceled'));
router.patch('/subscriptions/:id/revoke', setStatusHandler('revoked'));
// Suspend a website (or any subscription) for non-payment. past_due, not revoked, so
// the existing renew route can reactivate it -- renew refuses only 'revoked'.
router.patch('/subscriptions/:id/suspend', setStatusHandler('past_due'));

// A website = a subscription of the 'website' product + a websites row pinning its
// domain. Created active (a site is live immediately; no device-activation step).
router.post('/websites', async (req, res) => {
  const { userId, domain, billingInterval, currentPeriodEnd } = req.body;
  if (!userId || !domain) {
    return res.status(400).json({ error: 'userId and domain are required' });
  }

  const host = normalizeDomain(domain);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
    return res.status(400).json({ error: 'domain is not a valid hostname' });
  }

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id')
    .eq('slug', 'website')
    .single();
  if (productError || !product) {
    return res.status(500).json({ error: 'website product missing -- run src/db/websites.sql' });
  }

  const interval = billingInterval === 'yearly' ? 'yearly' : 'monthly';
  let periodEnd;
  if (currentPeriodEnd) {
    periodEnd = new Date(currentPeriodEnd);
  } else {
    periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + (interval === 'yearly' ? 12 : 1));
  }
  if (Number.isNaN(periodEnd.getTime())) {
    return res.status(400).json({ error: 'currentPeriodEnd is invalid' });
  }

  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      product_id: product.id,
      billing_interval: interval,
      status: 'active',
      current_period_end: periodEnd.toISOString(),
    })
    .select('id')
    .single();
  if (subError) {
    return res.status(400).json({ error: subError.message });
  }

  const { data: website, error: siteError } = await supabase
    .from('websites')
    .insert({ subscription_id: subscription.id, domain: host })
    .select('id, domain, created_at, subscriptions(id, status, current_period_end, billing_interval, app_users(email))')
    .single();
  if (siteError) {
    // Roll back the subscription we just made so a rejected domain leaves no orphan row.
    await supabase.from('subscriptions').delete().eq('id', subscription.id);
    if (siteError.code === '23505') {
      return res.status(409).json({ error: 'Domain already registered' });
    }
    return res.status(400).json({ error: siteError.message });
  }

  res.status(201).json(website);
});

const WEBSITE_KINDS = ['client', 'demo', 'internal'];

router.patch('/websites/:id', async (req, res) => {
  const { domain, kind, domainRenewsOn } = req.body;
  const patch = {};

  // '' clears it back to untracked, which is how you tell the digest to stop asking about
  // a domain you have handed over or let go. Anything else has to parse as a real date --
  // a typo stored as garbage would silently drop the row out of the renewal query.
  if (domainRenewsOn !== undefined) {
    if (domainRenewsOn === null || domainRenewsOn === '') {
      patch.domain_renews_on = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(domainRenewsOn) || Number.isNaN(Date.parse(domainRenewsOn))) {
      return res.status(400).json({ error: 'domainRenewsOn must be a YYYY-MM-DD date' });
    } else {
      patch.domain_renews_on = domainRenewsOn;
    }
  }

  if (domain !== undefined) {
    const host = normalizeDomain(domain);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
      return res.status(400).json({ error: 'domain is not a valid hostname' });
    }
    patch.domain = host;
  }
  if (kind !== undefined) {
    if (!WEBSITE_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of ${WEBSITE_KINDS.join(', ')}` });
    }
    patch.kind = kind;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  const { data, error } = await supabase
    .from('websites')
    .update(patch)
    .eq('id', req.params.id)
    .select('id, domain, kind, domain_renews_on')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Domain already registered' });
    // websites_client_needs_subscription (src/db/website_kinds.sql). Reworded because the
    // raw constraint violation says nothing about what the admin actually did wrong.
    if (error.code === '23514') {
      return res.status(409).json({ error: 'A client website needs a subscription -- add it from Add website instead' });
    }
    return res.status(error.code === 'PGRST116' ? 404 : 400).json({ error: error.message });
  }

  res.json(data);
});

// Deletes the websites row ONLY, never the subscription. invoices.subscription_id is
// `on delete cascade` (src/db/invoices.sql), so removing a subscription here would take
// its invoices with it -- financial records destroyed to unregister a domain. A client
// site's billing is ended from the subscription itself, deliberately somewhere else.
router.delete('/websites/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('websites')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: 'Website not found' });
  }

  // A body, not 204: authedFetch in the admin client always parses a JSON response, and
  // an empty one throws. Matches DELETE /users/:id.
  res.json({ success: true });
});

// Replaces the removed self-service POST /api/subscription/renew -- renewal
// is admin-only until a payment provider exists to trigger it on real money.
router.patch('/subscriptions/:id/renew', async (req, res) => {
  const { data: subscription, error: findError } = await supabase
    .from('subscriptions')
    .select('id, status, billing_interval, current_period_end')
    .eq('id', req.params.id)
    .single();
  if (findError) {
    return res.status(findError.code === 'PGRST116' ? 404 : 500).json({ error: findError.message });
  }
  if (subscription.status === 'revoked') {
    return res.status(409).json({ error: 'Subscription is revoked' });
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .update({
      current_period_end: nextPeriodEnd(subscription.current_period_end, subscription.billing_interval).toISOString(),
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id)
    .select()
    .single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

module.exports = router;
