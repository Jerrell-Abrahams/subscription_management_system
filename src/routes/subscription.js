const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');
const { signCertificate } = require('../lib/licenseCert');
const { superUserClaim, publicSubscription } = require('../lib/superUserCode');

const router = express.Router();
router.use(auth);

async function findOwnSubscription(productSlug, userId) {
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, enforce_activation_limit')
    .eq('slug', productSlug)
    .single();
  if (productError || !product) {
    return { data: null, product: null, error: productError || new Error('Product not found') };
  }
  const result = await supabase
    .from('subscriptions')
    .select('*')
    .eq('product_id', product.id)
    .eq('user_id', userId)
    .single();
  return { ...result, product };
}

router.post('/activate', async (req, res) => {
  const { product, deviceFingerprint, deviceName } = req.body;
  if (!product || !deviceFingerprint) {
    return res.status(400).json({ error: 'product and deviceFingerprint are required' });
  }

  const { data: subscription, product: productRow, error } = await findOwnSubscription(product, req.user.userId);
  if (error || !subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  if (subscription.status === 'revoked' || subscription.status === 'expired' || subscription.status === 'canceled') {
    return res.status(409).json({ error: `Subscription is ${subscription.status}` });
  }

  const { data: existingActivation } = await supabase
    .from('activations')
    .select('*')
    .eq('subscription_id', subscription.id)
    .eq('device_fingerprint', deviceFingerprint)
    .maybeSingle();

  if (existingActivation) {
    return res.json({
      subscription: publicSubscription(subscription),
      activation: existingActivation,
      certificate: signCertificate({
        userId: req.user.userId,
        product,
        deviceFingerprint,
        status: subscription.status,
        periodEnd: subscription.current_period_end,
        issuedAt: Date.now(),
        superUser: superUserClaim(subscription),
      }),
    });
  }

  const { data: activation, error: activationError } = await supabase
    .from('activations')
    .insert({ subscription_id: subscription.id, device_fingerprint: deviceFingerprint, device_name: deviceName })
    .select()
    .single();
  if (activationError) {
    return res.status(500).json({ error: activationError.message });
  }

  // Insert first, then count: two concurrent activations that both passed a
  // pre-insert check could exceed max_activations, but counting after our own
  // insert means the loser sees the overflow and backs out. Also self-heals
  // any drift between the stored counter and the actual activation rows.
  const { count } = await supabase
    .from('activations')
    .select('*', { count: 'exact', head: true })
    .eq('subscription_id', subscription.id);

  // ponytail: no max_activations gate for products with enforce_activation_limit
  // = false - the pawn-shop appraisal tool runs off a USB drive plugged into a
  // different customer's machine on every use, so a new device fingerprint on
  // every run is normal there, not abuse.
  if (productRow.enforce_activation_limit && count > subscription.max_activations) {
    await supabase.from('activations').delete().eq('id', activation.id);
    return res.status(409).json({ error: 'Activation limit reached for this subscription' });
  }

  const { data: updatedSubscription, error: updateError } = await supabase
    .from('subscriptions')
    .update({
      current_activations: count,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id)
    .select()
    .single();
  if (updateError) {
    return res.status(500).json({ error: updateError.message });
  }

  res.status(201).json({
    subscription: publicSubscription(updatedSubscription),
    activation,
    certificate: signCertificate({
      userId: req.user.userId,
      product,
      deviceFingerprint,
      status: updatedSubscription.status,
      periodEnd: updatedSubscription.current_period_end,
      issuedAt: Date.now(),
      superUser: superUserClaim(updatedSubscription),
    }),
  });
});

// Self-service renewal was removed: with no payment provider wired up, any
// authenticated customer could extend their own subscription for free.
// Renewal now lives at PATCH /api/admin/subscriptions/:id/renew (admin-only)
// until a payment webhook exists to trigger it.

router.get('/status', async (req, res) => {
  const { product } = req.query;
  if (!product) {
    return res.status(400).json({ error: 'product query parameter is required' });
  }

  const { data: subscription, error } = await findOwnSubscription(product, req.user.userId);
  if (error || !subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  res.json({
    subscription: publicSubscription(subscription),
    activationCount: subscription.current_activations,
    certificate: signCertificate({
      userId: req.user.userId,
      product,
      status: subscription.status,
      periodEnd: subscription.current_period_end,
      issuedAt: Date.now(),
      superUser: superUserClaim(subscription),
    }),
  });
});

module.exports = router;
