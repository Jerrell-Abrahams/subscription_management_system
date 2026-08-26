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
const documentRoutes = require('./routes/documents');
const leadsRoutes = require('./routes/leads');
const { router: qrRoutes, redirect: qrRedirect } = require('./routes/qr');
const { router: financeRoutes, syncPaystack, NIGHTLY_DAYS, daysAgo } = require('./routes/finance');
const dailySubscriptionCheck = require('./jobs/dailySubscriptionCheck');

const app = express();
// Content-Disposition is exposed because the documents route streams a PDF back for the
// browser to save, and the admin console reads the filename off that header.
// Vite takes the next free port when 5173 is busy, so a fixed dev allowlist turns a stale
// process from an hour ago into an opaque "Failed to fetch" on 5176 -- the browser reports
// a blocked preflight exactly the same way it reports a server that isn't running.
//
// Off production, therefore, any localhost port is allowed. The ADMIN_ORIGIN allowlist is
// what governs the deployed API, where NODE_ENV is 'production' and this shortcut is off.
const ALLOWED_ORIGINS = (process.env.ADMIN_ORIGIN || 'http://localhost:5173').split(',');
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const originAllowed = (origin) =>
  // No Origin header at all is curl, Vercel's cron and same-origin -- never a browser
  // doing something cross-site, so it is not the allowlist's business.
  !origin ||
  ALLOWED_ORIGINS.includes(origin) ||
  (process.env.NODE_ENV !== 'production' && LOCALHOST.test(origin));

app.use(
  cors({
    origin: (origin, callback) => callback(null, originAllowed(origin)),
    exposedHeaders: ['Content-Disposition'],
  })
);
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
// broader one first would run adminAuth twice on every invoice request. Same for
// finance and documents.
app.use('/api/admin/invoices', invoiceRoutes);
app.use('/api/admin/finance', financeRoutes);
app.use('/api/admin/documents', documentRoutes);
app.use('/api/admin/qr', qrRoutes);
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
  // and stays that way. Caught, not awaited into the response: a Paystack outage or a
  // rotated key must never stop subscriptions expiring -- the ledger can catch up
  // tomorrow, an unexpired subscription is someone using software they stopped paying for.
  // The Sync button on the Finance tab is where you'd see the error and act on it.
  await syncPaystack({ from: daysAgo(NIGHTLY_DAYS) }).catch((err) =>
    console.error('[paystack] nightly sync failed:', err.message)
  );
  res.json({ ok: true });
});

// Public QR scan redirect, and the reason this is the last route registered: it is a
// single-segment catch-all, so anything mounted after it would be unreachable. It serves
// qr.complexai.co.za, which is aliased to this same Vercel project -- vercel.json already
// rewrites every path into Express, so the subdomain needs no routing config of its own.
// On the .vercel.app host it just means an unmatched one-segment path answers "not found"
// in HTML rather than Express's default, which costs nothing.
//
// Express 5 note: path-to-regexp v8 dropped inline regex params, so the 4-character shape
// cannot be asserted here. src/routes/qr.js validates it and 404s on anything else.
app.get('/:code', rateLimit({ windowMs: 60 * 1000, limit: 120 }), qrRedirect);

const port = process.env.PORT || 3000;

// Only bind a port / start the local cron scheduler when run directly
// (`node src/server.js`), not when Vercel requires() this as a module.
if (require.main === module) {
  dailySubscriptionCheck.start();
  app.listen(port, () => console.log(`license-platform listening on port ${port}`));
}

module.exports = app;
