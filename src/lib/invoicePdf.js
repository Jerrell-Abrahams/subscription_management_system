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
  lines,
  rect,
  hrule,
  drawLogo,
  toBuffer,
} = require('./pdfBase');
const {
  formatMoney,
  formatDate,
  documentNumber,
  lineDescription,
  linePeriod,
  billToLines,
  paymentReference,
} = require('./invoices');

// Implements the Claude Design document "Invoice INV-0011.dc.html".
//
// That design is authored in CSS pixels on an A4 <doc-page>; src/lib/pdfBase.js owns the
// px->pt conversion and the drawing primitives, so every measurement below is written in
// the design's own px.
const PAD = 64;
const PAD_BOTTOM = 56;
const LEFT = PAD;
const RIGHT = PAGE_W - PAD;
const CONTENT_W = RIGHT - LEFT;

// One layout for both documents. A receipt is the same transaction after the money
// arrived, so it differs in heading, the meta rows, and swapping "how to pay" for a paid
// marker -- never in a second template that could drift from this one.
function renderInvoicePdf({ kind, invoice, subscription, customer, settings = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  registerFonts(doc);

  const isReceipt = kind === 'receipt';
  const number = documentNumber(kind, invoice.number);
  const amount = formatMoney(invoice.amount);

  // ---- masthead --------------------------------------------------------------
  let leftY = PAD;
  if (fs.existsSync(LOGO)) {
    leftY += drawLogo(doc, LOGO, LEFT - 8, PAD, 190);
  } else {
    text(doc, settings.business_name || '', LEFT, PAD, { font: 'display', size: 30, color: INK_STRONG });
    leftY += 36;
  }

  const sellerAddress = (settings.address || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const sellerLines = [
    settings.legal_name,
    ...sellerAddress,
    settings.tax_number ? `Tax no. ${settings.tax_number}` : null,
    settings.email,
    settings.phone,
  ].filter(Boolean);
  const leftBottom = lines(doc, sellerLines, LEFT, leftY + 18, 21.25, { size: 12.5, color: MUTED });

  rightText(doc, isReceipt ? 'RECEIPT' : 'INVOICE', RIGHT, PAD, {
    font: 'display',
    size: 44,
    tracking: 0.14,
    color: INK_STRONG,
  });

  const meta = isReceipt
    ? [
        ['Receipt no.', number],
        ['For invoice', documentNumber('invoice', invoice.number)],
        ['Date paid', formatDate(invoice.paid_at || Date.now())],
        ...(invoice.payment_reference ? [['Reference', invoice.payment_reference]] : []),
      ]
    : [
        ['Invoice no.', number],
        ['Issued', formatDate(invoice.sent_at || Date.now())],
        ['Due', formatDate(invoice.due_date)],
      ];

  // Two auto-width columns, 20px apart, the pair flush right -- the design's grid.
  const valueW = Math.max(...meta.map(([, v]) => widthOf(doc, v, { size: 13 })));
  const labelW = Math.max(...meta.map(([l]) => widthOf(doc, l, { size: 13, font: 'bodySemi' })));
  const labelX = RIGHT - valueW - 20 - labelW;
  let metaY = PAD + 44 + 20;
  for (const [label, value] of meta) {
    text(doc, label, labelX, metaY, { size: 13, font: 'bodySemi', color: INK_STRONG });
    rightText(doc, value, RIGHT, metaY, { size: 13, color: INK });
    metaY += 13 * 1.2 + 6;
  }

  // ---- billed to -------------------------------------------------------------
  let y = Math.max(leftBottom, metaY) + 44;
  text(doc, 'BILLED TO', LEFT, y, { font: 'displaySemi', size: 13, tracking: 0.22, color: INK_STRONG });
  y += 13 * 1.2 + 8;

  const to = billToLines(customer);
  if (to.length) {
    text(doc, to[0], LEFT, y, { size: 16, font: 'bodySemi', color: INK });
    y += 16 * 1.75;
    y = lines(doc, to.slice(1), LEFT, y, 14 * 1.75, { size: 14, color: INK });
  }

  // ---- line item -------------------------------------------------------------
  y += 44;
  const AMOUNT_COL = 150;
  const PERIOD_COL = 200;
  const periodX = RIGHT - AMOUNT_COL - PERIOD_COL;

  const headH = 14 + 12.5 * 1.2 + 14;
  rect(doc, LEFT, y, CONTENT_W, headH, INK_STRONG);
  const headStyle = { font: 'display', size: 12.5, tracking: 0.14, color: PAPER };
  text(doc, 'DESCRIPTION', LEFT + 20, y + 14, headStyle);
  text(doc, 'PERIOD', periodX + 20, y + 14, headStyle);
  rightText(doc, 'AMOUNT', RIGHT - 20, y + 14, headStyle);
  y += headH;

  const rowH = 20 + 14 * 1.2 + 20;
  rect(doc, LEFT, y, CONTENT_W, rowH, ROW_BG);
  text(doc, invoice.description || lineDescription(subscription), LEFT + 20, y + 20, {
    size: 14,
    font: 'bodySemi',
    color: INK,
  });
  text(doc, linePeriod(invoice.period_start, invoice.period_end), periodX + 20, y + 20, {
    size: 14,
    color: MUTED,
  });
  rightText(doc, amount, RIGHT - 20, y + 20, { size: 14, color: INK });
  y += rowH;

  // ---- totals ----------------------------------------------------------------
  y += 28;
  const totalsX = RIGHT - 320;
  for (const [label, value, muted] of [
    ['Subtotal', amount, false],
    ['VAT', formatMoney(0), true],
  ]) {
    text(doc, label, totalsX, y, { size: 13.5, color: MUTED });
    rightText(doc, value, RIGHT, y, { size: 13.5, color: muted ? MUTED : INK });
    y += 13.5 * 1.2 + 10;
    hrule(doc, totalsX, RIGHT, y, HAIRLINE);
    y += 10;
  }

  // Label and figure sit on a shared baseline at different sizes, so the smaller one is
  // pushed down by the difference in ascent (~0.72 of the em for both faces).
  y += 4;
  text(doc, isReceipt ? 'Total paid' : 'Total due', totalsX, y + (26 - 16) * 0.72, {
    font: 'display',
    size: 16,
    tracking: 0.06,
    color: GOLD,
  });
  rightText(doc, amount, RIGHT, y, { font: 'display', size: 26, color: GOLD });
  y += 26 * 1.2 + 10;

  // Required, not decorative: an unregistered vendor may not charge VAT, so the document
  // says outright that none was.
  rightText(doc, 'No VAT charged — not a registered VAT vendor.', RIGHT, y, { size: 11.5, color: FAINT });

  // ---- bottom block, anchored to the page foot -------------------------------
  const footerLines = [settings.business_name, settings.legal_name, settings.email, settings.phone]
    .filter(Boolean)
    .join(' · ');
  const footerY = PAGE_H - PAD_BOTTOM - 11 * 1.2;
  const footerRuleY = footerY - 16;
  const blockBottom = footerRuleY - 32;

  if (isReceipt) {
    const markH = 64;
    rect(doc, LEFT, blockBottom - markH, 260, markH, CALLOUT_BG);
    rect(doc, LEFT, blockBottom - markH, 3, markH, GOLD);
    text(doc, 'PAID IN FULL', LEFT + 20, blockBottom - markH + 20, {
      font: 'display',
      size: 18,
      tracking: 0.08,
      color: GOLD,
    });
  } else {
    const bank = [
      ['Bank', settings.bank_name],
      ['Account name', settings.bank_account_name],
      ['Account number', settings.bank_account_number],
      ['Account type', settings.bank_account_type],
      ['Branch code', settings.bank_branch_code],
    ].filter(([, value]) => value);

    if (bank.length) {
      const step = 13 * 1.2 + 5;
      const bankTop = blockBottom - (13 * 1.2 + 10 + bank.length * step);
      text(doc, 'BANKING DETAILS', LEFT, bankTop, {
        font: 'displaySemi',
        size: 13,
        tracking: 0.22,
        color: INK_STRONG,
      });
      const valueX = LEFT + Math.max(...bank.map(([l]) => widthOf(doc, l, { size: 13 }))) + 24;
      let bankY = bankTop + 13 * 1.2 + 10;
      for (const [label, value] of bank) {
        text(doc, label, LEFT, bankY, { size: 13, color: MUTED });
        text(doc, value, valueX, bankY, { size: 13, color: INK });
        bankY += step;
      }
    }

    // Payment reference callout, right-aligned to the margin.
    const boxW = 250;
    const boxX = RIGHT - boxW;
    const reference = `"${paymentReference(customer, number)}"`;
    const noteW = boxW - 40;
    doc.font('body').fontSize(px(11.5));
    const noteH = doc.heightOfString('Please use this as your payment reference.', { width: px(noteW) }) / PX;
    const boxH = 18 + 11.5 * 1.2 + 6 + 15 * 1.2 + 6 + noteH + 18;
    const boxY = blockBottom - boxH;

    rect(doc, boxX, boxY, boxW, boxH, CALLOUT_BG);
    rect(doc, boxX, boxY, 3, boxH, GOLD);
    text(doc, 'PAYMENT REFERENCE', boxX + 20, boxY + 18, {
      font: 'displaySemi',
      size: 11.5,
      tracking: 0.18,
      color: INK_STRONG,
    });
    text(doc, reference, boxX + 20, boxY + 18 + 11.5 * 1.2 + 6, {
      size: 15,
      font: 'bodySemi',
      color: INK,
      width: noteW,
    });
    text(doc, 'Please use this as your payment reference.', boxX + 20, boxY + 18 + 11.5 * 1.2 + 6 + 15 * 1.2 + 6, {
      size: 11.5,
      color: FAINT,
      width: noteW,
    });
  }

  hrule(doc, LEFT, RIGHT, footerRuleY, HAIRLINE);
  text(doc, footerLines, LEFT, footerY, {
    size: 11,
    tracking: 0.04,
    color: FAINT,
    width: CONTENT_W,
    align: 'center',
  });

  return toBuffer(doc);
}

module.exports = { renderInvoicePdf };
