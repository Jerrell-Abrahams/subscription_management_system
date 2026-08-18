const fs = require('fs');
const path = require('path');

// The drawing primitives shared by every PDF this app issues -- invoices, receipts and
// the client documents in src/documents.
//
// Everything is written in CSS pixels on an A4 page and converted at draw time. A4 at CSS
// 96dpi is 793.7 x 1122.5px and pdfkit works in points at 72dpi, so one design pixel is
// exactly 0.75pt. A number changed in a design maps one-to-one onto a number here, with no
// arithmetic in between to get wrong.
const PX = 0.75;
const px = (n) => n * PX;

const PAGE_W = 793.7;
const PAGE_H = 1122.5;

const INK = '#16171a';
const INK_STRONG = '#0e0f12';
const MUTED = '#5f6268';
const FAINT = '#8a8d92';
const HAIRLINE = '#e6e7e9';
const ROW_BG = '#f5f6f7';
const GOLD = '#a8834a';
const CALLOUT_BG = '#f8f3ea';
const PAPER = '#ffffff';

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const LOGO = path.join(ASSETS, 'logo.svg');
const FONTS = {
  display: path.join(ASSETS, 'fonts', 'SpaceGrotesk-Bold.ttf'),
  displaySemi: path.join(ASSETS, 'fonts', 'SpaceGrotesk-SemiBold.ttf'),
  body: path.join(ASSETS, 'fonts', 'Archivo-Regular.ttf'),
  bodySemi: path.join(ASSETS, 'fonts', 'Archivo-SemiBold.ttf'),
};

// ponytail: Helvetica stand-in when assets/fonts is missing. It looks wrong, but a
// checkout or a deploy that dropped the font files still issues invoices instead of
// 500-ing on send -- an ugly invoice beats an invoice that never went out.
function registerFonts(doc) {
  const haveAll = Object.values(FONTS).every((file) => fs.existsSync(file));
  const fallback = { display: 'Helvetica-Bold', displaySemi: 'Helvetica-Bold', body: 'Helvetica', bodySemi: 'Helvetica-Bold' };
  for (const name of Object.keys(FONTS)) {
    doc.registerFont(name, haveAll ? FONTS[name] : fallback[name]);
  }
}

function applyStyle(doc, o) {
  const size = o.size || 14;
  doc.font(o.font || 'body').fontSize(px(size)).fillColor(o.color || INK);
  return o.tracking ? { characterSpacing: px(size * o.tracking) } : {};
}

function text(doc, str, xPx, yPx, o = {}) {
  const opts = { lineBreak: false, ...applyStyle(doc, o) };
  if (o.width) {
    opts.width = px(o.width);
    opts.align = o.align || 'left';
    opts.lineBreak = true;
  }
  doc.text(String(str), px(xPx), px(yPx), opts);
}

function widthOf(doc, str, o = {}) {
  const opts = applyStyle(doc, o);
  return doc.widthOfString(String(str), opts) / PX;
}

// Measured and placed rather than handed to pdfkit's align:'right', because character
// spacing is emitted after the final glyph too -- right-aligning the raw measured width
// would hang every tracked line one space short of the margin.
function rightText(doc, str, rightPx, yPx, o = {}) {
  const trailing = o.tracking ? (o.size || 14) * o.tracking : 0;
  text(doc, str, rightPx - (widthOf(doc, str, o) - trailing), yPx, o);
}

function lines(doc, arr, xPx, yPx, leading, o = {}) {
  arr.forEach((line, i) => text(doc, line, xPx, yPx + i * leading, o));
  return yPx + arr.length * leading;
}

const rect = (doc, x, y, w, h, color) => doc.rect(px(x), px(y), px(w), px(h)).fill(color);

const hrule = (doc, x1, x2, y, color) =>
  doc.moveTo(px(x1), px(y)).lineTo(px(x2), px(y)).lineWidth(px(1)).strokeColor(color).stroke();

// The wordmark is flat <path> elements with solid fills and no transforms, so pdfkit's
// own .path() draws it directly from the SVG's path data.
// ponytail: handles exactly that shape -- no groups, gradients, strokes or transforms.
// Swap in svg-to-pdfkit if the logo ever gains any of those.
function drawLogo(doc, file, xPx, yPx, widthPx) {
  const svg = fs.readFileSync(file, 'utf8');
  const box = /viewBox="([-\d.\s]+)"/.exec(svg);
  const [vx, vy, vw, vh] = box[1].trim().split(/\s+/).map(Number);
  const heightPx = (widthPx * vh) / vw;

  doc.save().translate(px(xPx), px(yPx)).scale(px(widthPx) / vw).translate(-vx, -vy);
  for (const tag of svg.matchAll(/<path\b([^>]*)>/g)) {
    const d = /\bd="([^"]+)"/.exec(tag[1]);
    if (!d) continue;
    const fill = /\bfill="([^"]+)"/.exec(tag[1]);
    // Unfilled paths are the mark itself; the explicit white ones are counters punched
    // back out of it, and they only work because they're drawn in document order.
    doc.path(d[1]).fill(fill ? fill[1] : INK_STRONG);
  }
  doc.restore();
  return heightPx;
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = {
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
};
