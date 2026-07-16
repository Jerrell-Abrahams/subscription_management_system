const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // ponytail: raw fetch instead of supabase.auth.signInWithPassword() on the
  // shared service-role client - that call mutates the client's internal
  // session state, which then silently downgrades every later request made
  // through this same client (imported server-wide) from service_role to
  // that customer's session, breaking RLS-bypassing writes like /activate.
  const authResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const authData = await authResponse.json();
  if (!authResponse.ok) {
    return res.status(401).json({ error: authData.error_description || authData.msg || 'Invalid credentials' });
  }

  const { data: profile } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  const token = jwt.sign(
    { userId: authData.user.id, email: authData.user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, user: profile });
});

module.exports = router;
