const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  PX,
  px,
  PAGE_W,
  PAGE_H,
  INK,
  INK_STRONG,
  MUTED,
  FAINT,
  HAIRLINE,
  ROW_BG,
  GOLD,
  CALLOUT_BG,
  PAPER,
  LOGO,
  registerFonts,
  text,
  widthOf,
  rightText,
  rect,
  hrule,
  drawLogo,
  drawSvg,
  svgBox,
  toBuffer,
  SIGNATURE,
} = require('./pdfBase');
const { bySlug, documentBlocks, withRef } = require('../documents');
const { plain } = require('../documents/markdown');
const { display, VARIABLES } = require('../documents/variables');
const { formatDate } = require('./invoices');
const { sastNow } = require('./sast');

// Renders a client document (agreement, schedule, SOW, change request, DPA) from the block
// list produced by src/documents. Shares its fonts, colours and logo with the invoice
// renderer through pdfBase, so a contract and an invoice read as the same company's paper.
//
// The invoice is a fixed one-page layout with every coordinate absolute. A contract is the
// opposite problem: flowing text of unknown length across an unknown number of pages. So
// this file hands the vertical flow to pdfkit itself -- the document is created with real
// margins, and doc.text() wraps and breaks pages on its own. What is managed by hand is
// only what pdfkit will not do: keeping a heading with the paragraph under it, breaking
// tables across pages with the header repeated, and numbering the pages once the total is
// finally known.

const PAD = 64;
const TOP = 64;
const BOTTOM = 96; // leaves room for the footer rule and page number
const LEFT = PAD;
const RIGHT = PAGE_W - PAD;
const CONTENT_W = RIGHT - LEFT;
const BODY_BOTTOM = PAGE_H - BOTTOM;

const BODY = 14;
const LEADING = 5.5;

// Vertical space before each kind of block. Headings get more air above than below, which
// is what visually attaches a heading to the text it introduces.
const SPACE_BEFORE = { h1: 34, h2: 26, h3: 18, p: 12, ul: 12, ol: 12, checklist: 12, table: 16, callout: 16, signature: 24, rule: 16 };

const cursor = (doc) => doc.y / PX;
const remaining = (doc) => BODY_BOTTOM - cursor(doc);

function moveTo(doc, yPx) {
  doc.y = px(yPx);
  doc.x = px(LEFT);
}

function gap(doc, amountPx) {
  if (cursor(doc) > TOP + 1) doc.y += px(amountPx);
}

// Starts a new page unless we are already at the top of an empty one.
function breakPage(doc) {
  if (cursor(doc) <= TOP + 1) return;
  doc.addPage();
  moveTo(doc, TOP);
}

// Draws a run list as one flowing paragraph, letting pdfkit wrap and break pages. Bold runs
// are emitted with continued:true so they join the same flow rather than starting a line.
function runs(doc, list, opts = {}) {
  const size = opts.size || BODY;
  const color = opts.color || INK;
  const font = opts.font || 'body';
  const boldFont = opts.boldFont || 'bodySemi';
  const width = px(opts.width || CONTENT_W);
  const shared = { width, align: opts.align || 'left', lineGap: px(opts.leading === undefined ? LEADING : opts.leading), indent: px(opts.indent || 0) };

  const items = list.length ? list : [{ text: '', bold: false }];
  doc.x = px(opts.x || LEFT);
  items.forEach((run, i) => {
    doc.font(run.bold ? boldFont : font).fontSize(px(size)).fillColor(color);
    doc.text(run.text, { ...shared, continued: i < items.length - 1 });
  });
}

// Height a run list will occupy, without drawing it. Used to decide page breaks up front.
function runsHeight(doc, list, opts = {}) {
  const size = opts.size || BODY;
  const width = px(opts.width || CONTENT_W);
  doc.font(opts.font || 'body').fontSize(px(size));
  const str = plain(list) || ' ';
  return doc.heightOfString(str, { width, lineGap: px(opts.leading === undefined ? LEADING : opts.leading) }) / PX;
}

// --- header ------------------------------------------------------------------------

function header(doc, template, meta) {
  let y = TOP;
  if (fs.existsSync(LOGO)) {
    y += drawLogo(doc, LOGO, LEFT - 8, y, 170);
  } else {
    text(doc, meta.businessName || 'COMPLEX AI', LEFT, y, { font: 'display', size: 26, color: INK_STRONG });
    y += 32;
  }
  text(doc, 'AI · Automation · Software', LEFT, y + 10, { size: 11, tracking: 0.16, color: GOLD });

  const rows = [
    ['Document', template.title],
    ['Reference', meta.ref],
    ['Version', meta.version],
    ['Effective', meta.effective],
  ].filter(([, v]) => v);

  const valueW = Math.max(...rows.map(([, v]) => widthOf(doc, v, { size: 11.5 })));
  const labelW = Math.max(...rows.map(([l]) => widthOf(doc, l, { size: 11.5, font: 'bodySemi' })));
  const labelX = RIGHT - valueW - 18 - labelW;
  let metaY = TOP + 2;
  for (const [label, value] of rows) {
    text(doc, label, labelX, metaY, { size: 11.5, font: 'bodySemi', color: INK_STRONG });
    rightText(doc, value, RIGHT, metaY, { size: 11.5, color: MUTED });
    metaY += 11.5 * 1.2 + 6;
  }

  y = Math.max(y + 26, metaY + 8);
  hrule(doc, LEFT, RIGHT, y, HAIRLINE);
  y += 30;

  text(doc, template.title, LEFT, y, { font: 'display', size: 30, color: INK_STRONG, width: CONTENT_W });
  y += doc.heightOfString(template.title, { width: px(CONTENT_W) }) / PX + 10;
  rect(doc, LEFT, y, 56, 3, GOLD);

  moveTo(doc, y + 26);
}

// --- blocks ------------------------------------------------------------------------

function heading(doc, block, level) {
  const spec =
    level === 1
      ? { size: 24, font: 'display', color: INK_STRONG }
      : level === 2
        ? { size: 17, font: 'display', color: INK_STRONG }
        : { size: 14.5, font: 'bodySemi', color: INK_STRONG };

  const h = runsHeight(doc, block.runs, { ...spec, leading: 2 });
  // Keep a heading with its first two lines of body text rather than stranding it at the
  // foot of a page.
  if (remaining(doc) < h + BODY * 2.6) breakPage(doc);
  runs(doc, block.runs, { ...spec, boldFont: spec.font, leading: 2 });
  doc.y += px(level === 3 ? 5 : 8);
}

function list(doc, block, ordered) {
  const MARKER_W = 22;
  block.items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}.` : '•';
    const h = runsHeight(doc, item, { width: CONTENT_W - MARKER_W });
    if (remaining(doc) < h) breakPage(doc);
    const top = cursor(doc);
    text(doc, marker, LEFT + 4, top, { size: BODY, color: ordered ? INK : GOLD });
    moveTo(doc, top);
    runs(doc, item, { x: LEFT + MARKER_W, width: CONTENT_W - MARKER_W });
    doc.y += px(4);
  });
}

// A tick-box line: the client marks these by hand on the printed document.
function checklist(doc, block) {
  const MARKER_W = 24;
  const BOX = 9.5;
  block.items.forEach((item) => {
    const h = runsHeight(doc, item, { width: CONTENT_W - MARKER_W });
    if (remaining(doc) < h) breakPage(doc);
    const top = cursor(doc);
    doc
      .rect(px(LEFT + 4), px(top + 2.5), px(BOX), px(BOX))
      .lineWidth(px(1))
      .strokeColor(MUTED)
      .stroke();
    moveTo(doc, top);
    runs(doc, item, { x: LEFT + MARKER_W, width: CONTENT_W - MARKER_W });
    doc.y += px(5);
  });
}

// Two-column tables are label/value pairs and read better with a narrow first column;
// anything wider is a real grid and gets equal columns.
function columnWidths(count) {
  if (count === 2) return [CONTENT_W * 0.34, CONTENT_W * 0.66];
  return Array(count).fill(CONTENT_W / count);
}

// Left edge of each column: a running sum, not a clever reduce. The clever version was off
// by one and drew the first two columns on top of each other, which stays inside the page
// margins and so passes every check that only asks whether the text landed on the paper.
function columnXs(widths) {
  const xs = [];
  let x = LEFT;
  for (const w of widths) {
    xs.push(x);
    x += w;
  }
  return xs;
}

// Whether a page break part-way through a table should reprint the header above the rows
// that continue on the new page.
//
// The answer is no when the row that overflowed IS the header: the break already puts it at
// the top of a fresh page, and reprinting leaves two stacked header bars with the first body
// row pushed a full row down. Both bars sit inside the margins, so this is a predicate to
// test rather than something to look for in the rendered bytes.
const repeatHeader = (hasHead, isHeadRow) => hasHead && !isHeadRow;

function table(doc, block) {
  const cols = Math.max(block.head.length, ...block.rows.map((r) => r.length), 1);
  const widths = columnWidths(cols);
  const xs = columnXs(widths);
  const PADX = 10;
  const PADY = 8;
  const SIZE = 12.5;

  // A label/value table is written with an empty header row; there is nothing to draw.
  const hasHead = block.head.some((cell) => plain(cell).trim() !== '');

  // Measured in the same face the row will be drawn in. Header cells are semibold and set
  // wider than the regular face, so measuring them as 'body' underestimates the row and
  // wraps the second line onto the ink background below it -- white text on white paper.
  const cellHeight = (cells, head) =>
    Math.max(
      ...Array.from({ length: cols }, (_, i) =>
        runsHeight(doc, cells[i] || [], {
          width: widths[i] - PADX * 2,
          size: SIZE,
          leading: 2,
          font: head ? 'bodySemi' : 'body',
        })
      ),
      SIZE
    ) + PADY * 2;

  const drawRow = (cells, { head = false, zebra = false } = {}) => {
    const h = cellHeight(cells, head);
    if (remaining(doc) < h) {
      breakPage(doc);
      if (repeatHeader(hasHead, head)) drawRow(block.head, { head: true });
    }
    const top = cursor(doc);
    if (head) rect(doc, LEFT, top, CONTENT_W, h, INK_STRONG);
    else if (zebra) rect(doc, LEFT, top, CONTENT_W, h, ROW_BG);

    for (let i = 0; i < cols; i += 1) {
      moveTo(doc, top + PADY);
      runs(doc, cells[i] || [], {
        x: xs[i] + PADX,
        width: widths[i] - PADX * 2,
        size: SIZE,
        leading: 2,
        color: head ? PAPER : INK,
        font: head ? 'bodySemi' : 'body',
        boldFont: head ? 'bodySemi' : 'bodySemi',
      });
    }
    moveTo(doc, top + h);
    if (!head) hrule(doc, LEFT, RIGHT, top + h, HAIRLINE);
  };

  if (hasHead) drawRow(block.head, { head: true });
  block.rows.forEach((row, i) => drawRow(row, { zebra: !hasHead && i % 2 === 1 }));
  doc.y += px(6);
}

// A blockquote. When it opens with the review phrase it becomes the attorney-review marker,
// deliberately loud: those are the clauses that must not reach a client unreviewed.
//
// The label is read off the text rather than assumed, because src/documents only strips
// review callouts from the client copy -- an ordinary note left under a hard-coded
// "ATTORNEY REVIEW REQUIRED" banner would be printed on the document the client signs.
const REVIEW_PREFIX = /^ATTORNEY REVIEW REQUIRED[:\s-]*/i;

function callout(doc, block) {
  const PADX = 18;
  const PADY = 14;
  const raw = plain(block.runs);
  const isReview = REVIEW_PREFIX.test(raw);
  const LABEL = isReview ? 'ATTORNEY REVIEW REQUIRED' : 'NOTE';
  const accent = isReview ? GOLD : MUTED;
  const body = raw.replace(REVIEW_PREFIX, '');
  const innerW = CONTENT_W - PADX * 2;

  doc.font('body').fontSize(px(12.5));
  const textH = doc.heightOfString(body, { width: px(innerW), lineGap: px(3) }) / PX;
  const h = PADY * 2 + 11.5 * 1.2 + 8 + textH;
  if (remaining(doc) < h) breakPage(doc);

  const top = cursor(doc);
  rect(doc, LEFT, top, CONTENT_W, h, isReview ? CALLOUT_BG : ROW_BG);
  rect(doc, LEFT, top, 3, h, accent);
  text(doc, LABEL, LEFT + PADX, top + PADY, { font: 'displaySemi', size: 11.5, tracking: 0.16, color: accent });
  moveTo(doc, top + PADY + 11.5 * 1.2 + 8);
  runs(doc, [{ text: body, bold: false }], { x: LEFT + PADX, width: innerW, size: 12.5, leading: 3, color: INK });
  moveTo(doc, top + h);
}

// What each side's signature block shows: a pre-printed value where we already know the
// answer, and an empty string where a rule is left for a pen.
//
// Both names are pre-printed: ours is the same on every document, and theirs is already
// stated in the party table on page one, so making them write it again is friction with
// no legal gain. Their DATE stays blank -- it is whenever they actually sign, which is not
// knowable when the PDF is made. Signature is blank on both sides for obvious reasons.
//
// Pure and exported so the decision is testable without parsing a PDF, the same way
// columnWidths and repeatHeader are.
const signatureRows = (meta = {}) => [
  { label: 'Name', ours: meta.signatory || '', theirs: meta.clientSignatory || '' },
  { label: 'Signature', ours: '', theirs: '' },
  { label: 'Date', ours: meta.signedOn || '', theirs: '' },
];

// Your signature, committed as assets/signature.svg -- the same treatment as the logo it
// sits next to in this same block. It is not a secret the way an API key is: it is already
// on every contract this system emails a client, so keeping it out of production is not
// protecting anything, and an env var only bought a deploy-time footgun (skip the Vercel
// step and every contract quietly ships with a blank line). Read per render, like the logo,
// so replacing the file takes effect on the next document with no restart.
// Same shape check drawSvg needs to do anything useful. A hand-edited or corrupted asset
// file is treated as absent rather than crashing the one thing standing between you and a
// signed PDF. Exported and pure so the guard is testable without writing to the real file.
const looksLikeSvg = (text) => typeof text === 'string' && text.includes('<path') && /viewBox="/.test(text);

const signatureSvg = () => {
  if (!fs.existsSync(SIGNATURE)) return null;
  const svg = fs.readFileSync(SIGNATURE, 'utf8');
  return looksLikeSvg(svg) ? svg : null;
};

// How tall a drawn signature may be. The rule sits 26 below its label, so this leaves the
// ink just clear of both.
const SIGNATURE_H = 22;

// Ruled fields rather than blank space: someone has to sign this with a pen.
function signature(doc, meta) {
  const COL_W = (CONTENT_W - 40) / 2;
  const rows = signatureRows(meta);
  const ink = signatureSvg();
  const STEP = 46;
  const h = 20 + 14 * 1.2 + 14 + rows.length * STEP;
  if (remaining(doc) < h) breakPage(doc);

  const top = cursor(doc);
  const columns = [
    { x: LEFT, heading: 'For ' + (meta.businessName || 'Complex AI'), side: 'ours' },
    { x: LEFT + COL_W + 40, heading: 'For the Client', side: 'theirs' },
  ];

  for (const col of columns) {
    text(doc, col.heading, col.x, top, { font: 'displaySemi', size: 12, tracking: 0.16, color: INK_STRONG });
    hrule(doc, col.x, col.x + COL_W, top + 18, GOLD);
    let y = top + 40;
    for (const row of rows) {
      text(doc, row.label, col.x, y, { size: 11.5, color: MUTED });
      // Right-aligned against the same rule, like the invoice's label/amount pairs -- the
      // label keeps the left edge, so a filled line cannot collide with its own caption.
      if (row[col.side]) rightText(doc, row[col.side], col.x + COL_W, y, { size: 12, color: INK });
      // Sits on the rule a pen would have used, and only ever on our side. Sized by height
      // first so any signature fits the row, then capped on width so a wide one cannot run
      // into the label. Wrapped because malformed path data makes pdfkit throw: a mistyped
      // env var must cost a ruled blank on one line, not every document the console makes.
      if (ink && col.side === 'ours' && row.label === 'Signature') {
        try {
          const { aspect } = svgBox(ink);
          const w = Math.min(COL_W * 0.62, SIGNATURE_H * aspect);
          drawSvg(doc, ink, col.x + COL_W - w, y + 24 - w / aspect, w, INK);
        } catch {
          // falls through to the ruled blank below
        }
      }
      hrule(doc, col.x, col.x + COL_W, y + 26, HAIRLINE);
      y += STEP;
    }
  }
  moveTo(doc, top + h + 10);
}

// --- footer ------------------------------------------------------------------------

// Run once at the end, over the buffered pages, because "of 14" is not knowable until the
// last block has been drawn.
function footers(doc, template, meta) {
  const range = doc.bufferedPageRange();
  const line = [meta.businessName, template.title, meta.ref].filter(Boolean).join('  ·  ');
  const y = PAGE_H - 56;

  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    hrule(doc, LEFT, RIGHT, y - 16, HAIRLINE);
    text(doc, line, LEFT, y, { size: 10, color: FAINT });
    rightText(doc, `Page ${i + 1} of ${range.count}`, RIGHT, y, { size: 10, color: FAINT });
  }
}

// --- entry point -------------------------------------------------------------------

// async so that a bad slug and a broken render both surface the same way -- as a rejection.
// A function that sometimes throws synchronously and sometimes rejects is a trap for the
// route handler calling it.
async function renderDocumentPdf({ slug, values: given = {}, settings = {}, reviewNotes = true }) {
  const template = bySlug(slug);
  if (!template) throw new Error(`Unknown document template: ${slug}`);

  // Resolved once here rather than inside documentBlocks, so the header meta block and the
  // {{DOCUMENT_REF}} in the clause text are guaranteed to be the same string.
  const values = withRef(slug, given);

  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: px(TOP), bottom: px(BOTTOM), left: px(LEFT), right: px(PAD) },
  });
  registerFonts(doc);

  const meta = {
    businessName: settings.business_name || 'Complex AI',
    ref: values.DOCUMENT_REF || '',
    version: values.DOCUMENT_VERSION || '1.0',
    // Through display(), like every {{EFFECTIVE_DATE}} in the clause text -- otherwise the
    // header prints the raw 2026-09-01 from the date input while the body prints 1 Sept
    // 2026, and the contract states its own effective date two ways on page one.
    effective: values.EFFECTIVE_DATE ? display('EFFECTIVE_DATE', values.EFFECTIVE_DATE) : '',
    // Pre-printed into the signature block. Read from the same registry entry the form
    // defaults from, so the name lives in one place -- and still overridable per document
    // on the templates that ask for it.
    signatory: values.COMPANY_REPRESENTATIVE || VARIABLES.COMPANY_REPRESENTATIVE.default,
    // The day the document was prepared. The client's date stays blank: they sign when
    // they sign, and parties signing on different dates is normal.
    // Already named in the party table on page one, so printing it again here costs
    // nothing and saves them writing it. Blank if you have not filled the field in.
    clientSignatory: values.CLIENT_REPRESENTATIVE || '',
    // sastNow(), not new Date(): a document prepared between 22:00-23:59 UTC (00:00-01:59
    // SAST) must print the SAST calendar date, not the server's UTC one.
    signedOn: formatDate(sastNow()),
  };

  header(doc, template, meta);

  for (const block of documentBlocks(slug, { values, settings, reviewNotes })) {
    if (block.type === 'pagebreak') {
      breakPage(doc);
      continue;
    }
    gap(doc, SPACE_BEFORE[block.type] || 12);
    switch (block.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        heading(doc, block, Number(block.type[1]));
        break;
      case 'p':
        if (remaining(doc) < BODY * 2.6) breakPage(doc);
        runs(doc, block.runs);
        break;
      case 'ul':
        list(doc, block, false);
        break;
      case 'ol':
        list(doc, block, true);
        break;
      case 'checklist':
        checklist(doc, block);
        break;
      case 'table':
        table(doc, block);
        break;
      case 'callout':
        callout(doc, block);
        break;
      case 'signature':
        signature(doc, meta);
        break;
      case 'rule':
        hrule(doc, LEFT, RIGHT, cursor(doc), HAIRLINE);
        doc.y += px(10);
        break;
      default:
        break;
    }
  }

  footers(doc, template, meta);
  return toBuffer(doc);
}

module.exports = { renderDocumentPdf, columnWidths, columnXs, repeatHeader, signatureRows, looksLikeSvg };
