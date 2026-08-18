const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { bySlug, listTemplates, documentFilename } = require('../documents');
const { renderDocumentPdf } = require('../lib/documentPdf');
const { loadSettings } = require('../lib/settings');

const router = express.Router();
router.use(adminAuth);

// Client documents: agreements, service schedules, statements of work, change requests and
// data processing agreements. Unlike invoices, nothing is stored -- the PDF is rendered on
// demand and streamed straight back as a download, so there is no bucket and no table to
// keep in step with the templates. The signed copy that comes back lives in your email.

// The catalogue, including the field list each template needs. The admin form builds itself
// from this, so adding a clause with a new {{VAR}} needs no change on the front end.
// Wrapped because listTemplates() reads the five .md files off disk. Letting an ENOENT
// escape hands Express's HTML error page to a caller that does res.json(), so the admin
// console reports a JSON parse error and the real cause never leaves the server log.
router.get('/', (req, res) => {
  try {
    res.json({ templates: listTemplates() });
  } catch (err) {
    console.error('[documents] could not read the templates:', err.message);
    res.status(500).json({ error: 'Could not read the document templates' });
  }
});

router.post('/:slug/pdf', async (req, res) => {
  const { slug } = req.params;
  if (!bySlug(slug)) {
    return res.status(404).json({ error: `Unknown document template: ${slug}` });
  }

  const { values = {}, reviewNotes = true } = req.body || {};

  try {
    // Read at render time, like the invoices do: the document has to capture the business
    // details as they stood when it was generated.
    const settings = await loadSettings();
    const buffer = await renderDocumentPdf({ slug, values, settings, reviewNotes });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${documentFilename(slug, values)}"`);
    res.send(buffer);
  } catch (err) {
    console.error(`[documents] could not render ${slug}:`, err.message);
    res.status(500).json({ error: 'Could not render the document' });
  }
});

module.exports = router;
