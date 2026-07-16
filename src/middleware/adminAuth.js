const supabase = require('../config/supabase');

module.exports = async function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const { data: { user }, error } = await supabase.auth.getUser(header.slice(7));
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const { data: profile } = await supabase.from('app_users').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  req.adminUser = user;
  next();
};
