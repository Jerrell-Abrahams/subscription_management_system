const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const { nextPeriodEnd } = require('../lib/renewal');

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

  res.status(201).json(profile);
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
