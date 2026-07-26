const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const { nextPeriodEnd } = require('../lib/renewal');
const { normalizeDomain } = require('../lib/websiteAccess');
const { sendOnboardingEmail } = require('../lib/email');

const router = express.Router();
router.use(adminAuth);

router.post('/users', async (req, res) => {
  const { email, password, fullName } = req.body;
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
    .insert({ id: created.user.id, email, full_name: fullName || null })
    .select()
    .single();
  if (profileError) {
    return res.status(500).json({ error: profileError.message });
  }

  // Best-effort - the account is already created and the admin already has
  // the password on screen, so a flaky email provider shouldn't fail this request.
  try {
    await sendOnboardingEmail({ email, password, fullName });
  } catch (emailError) {
    console.error('[admin] failed to send onboarding email:', emailError.message);
  }

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
