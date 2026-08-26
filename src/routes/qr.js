const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const supabase = require('../config/supabase');
const { generateCode, isCode, isHttpUrl, renderQr, qrFilename } = require('../lib/qr');

const router = express.Router();
router.use(adminAuth);

// Admin side. Reads are not here on purpose -- the console queries qr_codes/qr_scans
// straight through the anon-key client under RLS, the same way the Websites tab does.
// What has to come through the API is code allocation (collisions need a retry loop) and
// the QR render (QR Code Monkey pins its CORS header to its own site, so a browser cannot
// call it at all).

// Up to five attempts. Codes are 4 characters out of a 31-symbol alphabet -- ~923k of them --
// so a collision is a curiosity rather than a plan, and the unique index is what actually
// decides. Retrying on 23505 beats pre-checking with a select, which races anyway.
router.post('/', async (req, res) => {
  const { label, destination, websiteId } = req.body || {};

  if (!label || !label.trim()) return res.status(400).json({ error: 'A label is required' });
  if (!isHttpUrl(destination)) {
    return res.status(400).json({ error: 'The destination must be a full http:// or https:// URL' });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from('qr_codes')
      .insert({
        code: generateCode(),
        label: label.trim(),
        destination: destination.trim(),
        website_id: websiteId || null,
      })
      .select()
      .single();

    if (!error) return res.status(201).json(data);
    if (error.code !== '23505') {
      console.error('[qr] could not create a code:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  res.status(500).json({ error: 'Could not allocate an unused code' });
});

// Label, destination, owner and active state. The code itself is deliberately not editable:
// it is printed on things we cannot recall.
router.patch('/:id', async (req, res) => {
  const { label, destination, websiteId, active } = req.body || {};
  const patch = {};

  if (label !== undefined) {
    if (!label.trim()) return res.status(400).json({ error: 'A label is required' });
    patch.label = label.trim();
  }
  if (destination !== undefined) {
    if (!isHttpUrl(destination)) {
      return res.status(400).json({ error: 'The destination must be a full http:// or https:// URL' });
    }
    patch.destination = destination.trim();
  }
  if (websiteId !== undefined) patch.website_id = websiteId || null;
  if (active !== undefined) patch.active = Boolean(active);

  const { data, error } = await supabase.from('qr_codes').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });
  res.json(data);
});

// Serves the on-screen preview and both downloads from one render -- the console fetches it
// as a blob (an <img src> cannot carry the bearer token) and reuses that blob for the save
// buttons. Nothing is cached server-side: the image is a pure function of the code and the
// frozen style, so storing it would only be a cache of something we can always recompute.
router.get('/:id/image', async (req, res) => {
  const format = req.query.format === 'svg' ? 'svg' : 'png';

  const { data: row, error } = await supabase
    .from('qr_codes')
    .select('code, label')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !row) return res.status(404).json({ error: 'No such QR code' });

  try {
    const { buffer, contentType } = await renderQr(row.code, format);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${qrFilename(row.label, row.code, format)}"`);
    res.send(buffer);
  } catch (err) {
    console.error(`[qr] could not render ${row.code}:`, err.message);
    res.status(502).json({ error: 'Could not reach the QR generator. Try again in a moment.' });
  }
});

// --- Public scan redirect --------------------------------------------------------------
// Mounted at the root of qr.complexai.co.za in server.js, unauthenticated. This is the only
// part of the feature a customer's customer ever touches, so it stays boring.

const page = (res, status, title, body) =>
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title>` +
        `<div style="font:16px/1.5 system-ui,sans-serif;max-width:22rem;margin:20vh auto;padding:0 1.5rem;text-align:center;color:#111">` +
        `<h1 style="font-size:1.1rem;margin:0 0 .5rem">${title}</h1><p style="margin:0;color:#666">${body}</p></div>`
    );

async function redirect(req, res) {
  // no-store on every path out of here. A cached response is a scan that never reaches us
  // and, worse, a destination change that never reaches the person holding the card.
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.params.code || '').toLowerCase();
  if (!isCode(code)) return page(res, 404, 'Not found', 'That code does not look like one of ours.');

  const { data: row, error } = await supabase
    .from('qr_codes')
    .select('id, destination, active')
    .eq('code', code)
    .maybeSingle();

  if (error) {
    console.error('[qr] lookup failed:', error.message);
    return page(res, 503, 'Temporarily unavailable', 'Please try that code again shortly.');
  }
  if (!row) return page(res, 404, 'Not found', 'That code does not match anything.');
  if (!row.active) {
    return page(res, 410, 'No longer in use', 'This QR code has been retired.');
  }
  // Belt and braces: the write path already refuses anything else, but this is the line that
  // actually puts a URL in a Location header, so it does its own check.
  if (!isHttpUrl(row.destination)) {
    console.error(`[qr] ${code} has a destination that is not http(s)`);
    return page(res, 500, 'Misconfigured', 'This code points somewhere we will not send you.');
  }

  // Awaited, not fire-and-forget: Vercel freezes the function once the response is sent, so
  // a detached promise loses counts. Caught, because a lost count is a rounding error and a
  // customer who cannot reach the page is not.
  // ponytail: link-preview bots (WhatsApp, Slack) inflate this. Filter on user-agent only
  // if the numbers ever stop being believable.
  try {
    await supabase.rpc('record_qr_scan', { p_code_id: row.id });
  } catch (err) {
    console.error('[qr] could not record scan:', err.message);
  }

  // 302, never 301: browsers cache a 301 indefinitely, which would freeze the destination
  // for everyone who has already scanned -- the exact thing the short link exists to avoid.
  res.redirect(302, row.destination);
}

module.exports = { router, redirect };
