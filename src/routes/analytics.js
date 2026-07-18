const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  const { productId, eventType, payload } = req.body;
  if (!productId || !eventType) {
    return res.status(400).json({ error: 'productId and eventType are required' });
  }

  // Promote the scan count to a first-class integer column for easy
  // aggregation/sorting; the full payload jsonb is still stored too. Events
  // without a numeric successfulScans just leave scan_count null.
  const scanCount = Number.isInteger(payload?.successfulScans) ? payload.successfulScans : null;

  const { data, error } = await supabase
    .from('analytics_events')
    .insert({ user_id: req.user.userId, product_id: productId, event_type: eventType, scan_count: scanCount, payload })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

module.exports = router;
