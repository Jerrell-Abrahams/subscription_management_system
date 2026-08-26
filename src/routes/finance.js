const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const { fetchTransactions, toEntries, skipReason } = require('../lib/paystack');
const { sastDay: isoDay } = require('../lib/sast');

const router = express.Router();
router.use(adminAuth);

// The Finance page reads and writes finance_entries straight through the browser's anon
// key. This route exists for the one thing that cannot: PAYSTACK_SECRET_KEY is a
// server-side secret and must never reach the browser.

// How far back a sync with no explicit `from` reaches. Bounded rather than "everything" so
// a first pull can't fill the ledger with surprises.
const DEFAULT_DAYS = 90;
// What the nightly cron re-checks. Deliberately a window rather than "since last sync":
// there is no last-sync timestamp to keep correct, re-importing is free (the unique index
// drops the duplicates), and a week of overlap absorbs a missed night.
const NIGHTLY_DAYS = 7;

const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

async function syncPaystack({ from, to } = {}) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'Paystack is not configured: set PAYSTACK_SECRET_KEY on the server. ' +
        'It is the sk_live_... (or sk_test_...) key from Settings > API Keys & Webhooks in Paystack.'
    );
  }

  const transactions = await fetchTransactions({
    from: from || daysAgo(DEFAULT_DAYS),
    to: to || isoDay(new Date()),
    secretKey,
  });
  const rows = toEntries(transactions);

  // An already-imported transaction still maps to a row here and is dropped later by the
  // unique index, so transactions coming back with NOTHING mapped is systematic, not a
  // repeat sync: the account switched off ZAR, paid_at arrived in a shape occurredOn
  // rejects, amount stopped being a number. Returning { imported: 0 } reports all three to
  // the UI as "0 new entries", which Finance.jsx's own comment calls the normal result of a
  // second sync -- so real payments would go missing while the toast read as working.
  if (!rows.length) {
    if (transactions.length) {
      // Tallied via skipReason rather than guessed: ZAR is only one of several reasons a
      // transaction can fail to map (see src/lib/paystack.js), and pointing at the wrong
      // one sends whoever is debugging this to check currency while the real cause --
      // say, a paid_at shape occurredOn no longer parses -- goes unlooked-at.
      const counts = {};
      for (const t of transactions) {
        const reason = skipReason(t);
        if (reason) counts[reason] = (counts[reason] || 0) + 1;
      }
      const breakdown = Object.entries(counts)
        .map(([reason, n]) => `${n} ${reason}`)
        .join(', ');
      throw new Error(
        `Paystack returned ${transactions.length} successful transaction(s) but none could be read as ledger entries: ` +
          `${breakdown}. Nothing was imported.`
      );
    }
    return { found: 0, imported: 0 };
  }

  // ignoreDuplicates, NOT a merge: a re-sync must never overwrite a category you typed by
  // hand. Idempotent on finance_entries_source_external_idx -- the index created by
  // src/db/payfast.sql, which is provider-agnostic and outlived the integration that
  // introduced it -- and that is what makes overlapping windows and a double-fired cron
  // cost nothing.
  const { data, error } = await supabase
    .from('finance_entries')
    .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);

  return { found: transactions.length, imported: (data || []).length };
}

router.post('/paystack-sync', async (req, res) => {
  try {
    res.json(await syncPaystack(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = { router, syncPaystack, NIGHTLY_DAYS, daysAgo };
