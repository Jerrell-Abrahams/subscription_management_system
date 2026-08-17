require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');
const siteRoutes = require('./routes/site');
const analyticsRoutes = require('./routes/analytics');
const updatesRoutes = require('./routes/updates');
const adminRoutes = require('./routes/admin');
const invoiceRoutes = require('./routes/invoices');
const leadsRoutes = require('./routes/leads');
const { router: financeRoutes, syncPayfast, NIGHTLY_DAYS, daysAgo } = require('./routes/finance');
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
// Every lead search is a paid Google Places request, so this cap is about the bill
// rather than abuse -- it bounds what a stuck UI or an impatient admin can spend.
app.use('/api/leads/search', rateLimit({ windowMs: 60 * 1000, limit: 10 }));

app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
// Public site-status: called cross-origin from every customer domain's edge
// middleware, so it needs its own permissive CORS (the global one is locked to
// ADMIN_ORIGIN) and a per-IP cap against status flooding.
app.use('/api/site', cors({ origin: '*' }), rateLimit({ windowMs: 60 * 1000, limit: 120 }), siteRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/updates', updatesRoutes);
// Ahead of adminRoutes: both mounts match /api/admin/invoices, and registering the
// broader one first would run adminAuth twice on every invoice request. Same for finance.
app.use('/api/admin/invoices', invoiceRoutes);
app.use('/api/admin/finance', financeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leads', leadsRoutes);

// Vercel invokes this as a serverless function per request, so an in-process
// node-cron scheduler never fires reliably. Vercel Cron hits this route
// instead (see vercel.json), guarded by CRON_SECRET which Vercel sends
// automatically as a bearer token.
app.get('/api/cron/expire-subscriptions', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  // Expires lapsed subscriptions, then drafts invoices for the ones renewing this week.
  // Path kept as-is so vercel.json's cron registration doesn't need re-deploying.
  await dailySubscriptionCheck.run();

  // Bolted on here rather than inside dailySubscriptionCheck, which is about subscriptions
  // and stays that way. Caught, not awaited into the response: a Payfast outage, an expired
  // passphrase or a column rename must never stop subscriptions expiring -- the ledger can
  // catch up tomorrow, an unexpired subscription is someone using software they stopped
  // paying for. The manual Sync button is where you'd see the error and act on it.
  await syncPayfast({ from: daysAgo(NIGHTLY_DAYS) }).catch((err) =>
    console.error('[payfast] nightly sync failed:', err.message)
  );
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
