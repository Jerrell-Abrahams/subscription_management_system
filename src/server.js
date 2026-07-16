require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');
const analyticsRoutes = require('./routes/analytics');
const updatesRoutes = require('./routes/updates');
const adminRoutes = require('./routes/admin');
const dailySubscriptionCheck = require('./jobs/dailySubscriptionCheck');

const app = express();
app.use(cors({ origin: (process.env.ADMIN_ORIGIN || 'http://localhost:5173').split(',') }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Per-IP, in-memory (resets on restart; use a shared store if this ever runs
// multi-instance). Login is the credential brute-force target; subscription
// covers activation flooding. The admin dashboard is unaffected -- it
// authenticates against Supabase directly, not through these routes.
const fifteenMinutes = 15 * 60 * 1000;
app.use('/api/auth', rateLimit({ windowMs: fifteenMinutes, limit: 10 }));
app.use('/api/subscription', rateLimit({ windowMs: fifteenMinutes, limit: 60 }));

app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/admin', adminRoutes);

// Vercel invokes this as a serverless function per request, so an in-process
// node-cron scheduler never fires reliably. Vercel Cron hits this route
// instead (see vercel.json), guarded by CRON_SECRET which Vercel sends
// automatically as a bearer token.
app.get('/api/cron/expire-subscriptions', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  await dailySubscriptionCheck.expireStaleSubscriptions();
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;

// Only bind a port / start the local cron scheduler when run directly
// (`node src/server.js`), not when Vercel requires() this as a module.
if (require.main === module) {
  dailySubscriptionCheck.start();
  app.listen(port, () => console.log(`license-platform listening on port ${port}`));
}

module.exports = app;
