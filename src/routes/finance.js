const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const { fetchHistory, toEntries } = require('../lib/payfast');

const router = express.Router();
router.use(adminAuth);

// The Finance page reads and writes finance_entries straight through the browser's anon
// key. This route exists for the one thing that cannot: the Payfast passphrase is a
// server-side secret, so the sync has to happen here.

// How far back a sync with no explicit `from` reaches. The Finance page's own default.
const DEFAULT_DAYS = 90;
// What the nightly cron re-checks. Deliberately a window rather than "since last sync":
// there is no last-sync timestamp to keep correct, re-importing is free (the unique index
// drops the duplicates), and a week of overlap absorbs both a missed night and any
// transaction Payfast backdates.
const NIGHTLY_DAYS = 7;

// 'en-CA' is the ISO-shaped locale, so this is the SAST calendar date. toISOString() would
// be UTC and hand back yesterday until 02:00 -- the same trap admin/src/lib/format.js
// documents, and the reason a sync run at 00:30 must not silently drop today.
const isoDay = (date) => date.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

async function syncPayfast({ from, to } = {}) {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (!merchantId || !passphrase) {
    throw new Error(
      'Payfast is not configured: set PAYFAST_MERCHANT_ID and PAYFAST_PASSPHRASE on the server. ' +
        'The passphrase is not your merchant key -- set one under Settings > Security in Payfast.'
    );
  }

  const transactions = await fetchHistory({
    from: from || daysAgo(DEFAULT_DAYS),
    to: to || isoDay(new Date()),
    merchantId,
    passphrase,
  });
  const rows = toEntries(transactions);

  // Loud rather than quiet. Payfast's history column names are the one part of this that
  // has not been checked against a live account, so a mapping miss reports the columns it
  // actually received -- otherwise a rename looks exactly like an empty account, and the
  // failure mode of a silent money importer is a ledger you trust and shouldn't.
  if (transactions.length && !rows.length) {
    throw new Error(
      `Payfast returned ${transactions.length} transaction(s) but none could be read. ` +
        `Columns seen: ${Object.keys(transactions[0]).join(', ')}. Add the right names to pick() in src/lib/payfast.js.`
    );
  }
  if (!rows.length) return { found: 0, imported: 0 };

  // ignoreDuplicates, NOT a merge: a re-sync must never overwrite a category you typed by
  // hand. Idempotent on finance_entries_source_external_idx, which is what makes
  // overlapping windows and a double-fired cron cost nothing.
  const { data, error } = await supabase
    .from('finance_entries')
    .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);

  return { found: transactions.length, imported: (data || []).length };
}

router.post('/payfast-sync', async (req, res) => {
  try {
    res.json(await syncPayfast(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = { router, syncPayfast, NIGHTLY_DAYS, daysAgo };
