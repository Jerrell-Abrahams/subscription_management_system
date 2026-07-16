const express = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

// Public: client apps check for updates with no session.
router.get('/latest', async (req, res) => {
  const { product } = req.query;
  if (!product) {
    return res.status(400).json({ error: 'product query parameter is required' });
  }

  const { data: productRow, error: productError } = await supabase
    .from('products')
    .select('id')
    .eq('slug', product)
    .single();
  if (productError || !productRow) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const { data: update, error } = await supabase
    .from('updates')
    .select('*')
    .eq('product_id', productRow.id)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !update) {
    return res.status(404).json({ error: 'No updates found for this product' });
  }

  res.json(update);
});

module.exports = router;
