const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { renderDocumentPdf, columnWidths, columnXs, repeatHeader } = require('./documentPdf');
const { renderInvoicePdf } = require('./invoicePdf');
const { TEMPLATES } = require('../documents');
const { display } = require('../documents/variables');

// Renders for real -- pdfkit, the fonts and the logo, but no network and no database.
// The content itself is checked in src/documents/documents.test.js; this file only asks
// whether the renderer produces a valid, correctly paginated document.

const SETTINGS = {
  business_name: 'Complex AI',
  legal_name: 'J Abrahams t/a Complex AI',
  address: '1 Example Road\nCape Town\n7500',
  email: 'hello@complexai.co.za',
  phone: '021 555 0199',
};

const VALUES = {
  CLIENT_LEGAL_NAME: 'Acme Trading (Pty) Ltd',
  CLIENT_REG_NUMBER: '2019/123456/07',
  CLIENT_EMAIL: 'ops@acme.co.za',
  DOCUMENT_REF: 'MCA-2026-0001',
  EFFECTIVE_DATE: '2026-09-01',
  MONTHLY_FEE: '2500',
  PROJECT_FEE: '48000',
  SCOPE: '- Five-page marketing website\n- Contact form',
};

const A4_HEIGHT_PT = 841.89;
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// A real text placement: "1 0 0 1 x y Tm". Used both to find page content streams and to
// read positions out of them.
//
// Matching on the bare substring 'Tm' is not enough -- an inflated font subset can contain
// those two bytes, which made this count a ninth "page" in an eight-page document.
const PLACEMENT = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/g;

// pdfkit deflates each page's content stream; inflating them back is the only way to see
// where text actually landed, which is what the layout assertions below need.
function contentStreams(buf) {
  const out = [];
  const s = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      out.push(zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      // font files and other binary streams; not content
    }
  }
  return out.filter((c) => new RegExp(PLACEMENT.source).test(c));
}

const placements = (stream) =>
  [...stream.matchAll(new RegExp(PLACEMENT.source, 'g'))].map((m) => ({ x: +m[1], y: A4_HEIGHT_PT - +m[2] }));

for (const template of TEMPLATES) {
  test(`${template.slug} renders a valid multi-page PDF`, async () => {
    const buf = await renderDocumentPdf({ slug: template.slug, values: VALUES, settings: SETTINGS });
    assert.strictEqual(buf.slice(0, 4).toString(), '%PDF');
    assert.ok(pageCount(buf) > 1, `${template.slug} came out as a single page`);
  });

  test(`${template.slug} keeps every line inside the page`, async () => {
    const buf = await renderDocumentPdf({ slug: template.slug, values: VALUES, settings: SETTINGS });
    const all = contentStreams(buf).flatMap(placements);
    assert.ok(all.length > 0, 'no text was drawn');
    // 48pt is the left margin; the footer baseline sits at ~806pt. Anything outside this
    // band is text that has run off the paper or collided with the footer.
    assert.ok(Math.min(...all.map((p) => p.x)) >= 47, 'text drawn left of the margin');
    assert.ok(Math.max(...all.map((p) => p.x)) <= 548, 'text drawn past the right margin');
    assert.ok(Math.max(...all.map((p) => p.y)) <= 812, 'text drawn below the footer');
    assert.ok(Math.min(...all.map((p) => p.y)) >= 30, 'text drawn above the top margin');
  });

  test(`${template.slug} numbers every page`, async () => {
    const buf = await renderDocumentPdf({ slug: template.slug, values: VALUES, settings: SETTINGS });
    const pages = contentStreams(buf);
    assert.strictEqual(pages.length, pageCount(buf), 'a page has no content stream');
    for (const [i, page] of pages.entries()) {
      // The footer is two items on one baseline: the company line and "Page N of M".
      const footer = placements(page).filter((p) => p.y > 795);
      assert.strictEqual(footer.length, 2, `page ${i + 1} is missing its footer`);
    }
  });
}

test('the client copy is shorter than the review copy', async () => {
  const [review, client] = await Promise.all([
    renderDocumentPdf({ slug: 'master-agreement', values: VALUES, settings: SETTINGS, reviewNotes: true }),
    renderDocumentPdf({ slug: 'master-agreement', values: VALUES, settings: SETTINGS, reviewNotes: false }),
  ]);
  assert.ok(pageCount(client) < pageCount(review), 'stripping the review notes saved no pages');
});

test('an unfilled document still renders, as a form with blanks', async () => {
  const buf = await renderDocumentPdf({ slug: 'service-schedule', values: {}, settings: {} });
  assert.strictEqual(buf.slice(0, 4).toString(), '%PDF');
  assert.ok(pageCount(buf) > 1);
});

// Overlapping columns still land inside the page margins, so the geometry checks above
// cannot see them. This asserts the arithmetic directly instead.
test('table columns start where the previous one ends', () => {
  for (const count of [2, 3, 4, 5]) {
    const widths = columnWidths(count);
    const xs = columnXs(widths);
    assert.strictEqual(xs.length, count);
    assert.strictEqual(new Set(xs).size, count, `${count} columns share a left edge`);
    for (let i = 1; i < count; i += 1) {
      assert.ok(xs[i] > xs[i - 1], `column ${i} starts left of column ${i - 1}`);
      assert.ok(Math.abs(xs[i] - (xs[i - 1] + widths[i - 1])) < 0.001, `column ${i} overlaps or gaps`);
    }
    // The last column must end on the right margin, not past it.
    assert.ok(Math.abs(xs[count - 1] + widths[count - 1] - (793.7 - 64)) < 0.001);
  }
});

// A table header that overflowed the page used to be drawn twice: once by the recursive
// repeat-the-header call and again by the outer call that had already broken the page. Both
// bars land inside the margins, so the geometry checks above cannot see it -- but the whole
// bug is this predicate, so that is what gets asserted.
test('a page break reprints the table header only for body rows', () => {
  assert.strictEqual(repeatHeader(true, false), true, 'a body row continuing on a new page needs the header above it');
  assert.strictEqual(repeatHeader(true, true), false, 'the header itself must not be reprinted above itself');
  assert.strictEqual(repeatHeader(false, false), false, 'a table with no header row has nothing to repeat');
  assert.strictEqual(repeatHeader(false, true), false);
});

test('the effective date is formatted, not printed raw from the date input', () => {
  // The page-one meta block takes it through display(), the same path every
  // {{EFFECTIVE_DATE}} in the clause text takes. If it stopped, one contract would state
  // its own effective date as both "2026-09-01" and "1 Sept 2026".
  const shown = display('EFFECTIVE_DATE', '2026-09-01');
  assert.doesNotMatch(shown, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(shown, /2026/);
});

test('an unknown template is rejected', async () => {
  await assert.rejects(() => renderDocumentPdf({ slug: 'nope' }), /Unknown document template/);
});

// Guards the extraction of the shared drawing primitives into pdfBase.js: the documents and
// the invoices now share that code, so a change made for one must not break the other.
test('the invoice renderer still works on the shared pdf base', async () => {
  const invoice = {
    number: 11,
    amount: 2500,
    description: 'POS licence',
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    due_date: '2026-08-25',
    sent_at: '2026-08-18T00:00:00Z',
    paid_at: '2026-08-20T00:00:00Z',
    payment_reference: 'ACME-INV0011',
  };
  const args = {
    invoice,
    subscription: { id: 'sub-1', billing_interval: 'monthly', products: { name: 'Complex POS', slug: 'pos' } },
    customer: { email: 'ops@acme.co.za', full_name: 'Ada Ngwenya', company_name: 'Acme (Pty) Ltd' },
    settings: SETTINGS,
  };
  for (const kind of ['invoice', 'receipt']) {
    const buf = await renderInvoicePdf({ kind, ...args });
    assert.strictEqual(buf.slice(0, 4).toString(), '%PDF');
    assert.strictEqual(pageCount(buf), 1, 'an invoice must stay on one page');
  }
});
