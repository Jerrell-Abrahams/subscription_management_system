const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// QR Code Monkey. Free and unkeyed -- there is nothing to configure, and QR_MONKEY_BASE
// exists only so a test can point at a mock.
//
// Worth knowing where the fragility sits: this dependency is on the *create* path only.
// If Monkey disappears tomorrow you lose the ability to make new codes, but every code
// already printed keeps working, because the redirect in src/routes/qr.js is ours.
const MONKEY_BASE = process.env.QR_MONKEY_BASE || 'https://api.qrcode-monkey.com';

// What the QR actually encodes. Not the destination -- see the header of src/db/qr_codes.sql.
const QR_BASE_URL = () => (process.env.QR_BASE_URL || 'https://qr.complexai.co.za').replace(/\/+$/, '');

const MARK = path.join(__dirname, '..', '..', 'assets', 'qr-mark.png');

// The house style, frozen. Every code we hand out looks the same on purpose, so there is
// no styling UI and no per-record config to store.
//
// PNG, not SVG, and that is not a preference: Monkey silently drops SVG logos. It clears
// the space and draws nothing, returning 200 with a white hole where the mark should be --
// by URL and by upload alike. assets/qr-mark.png is the black mark rasterised for exactly
// this reason. Do not "improve" it back to a vector.
const STYLE = {
  body: 'circle',
  eye: 'frame1',
  eyeBall: 'ball1',
  bodyColor: '#000000',
  bgColor: '#ffffff',
  logoMode: 'clean',
};

// 1000px covers a ~8cm print at 300dpi, and one render serves both the on-screen preview
// and the PNG download so there is no second size to keep in step. Anything bigger than a
// flyer should be taking the SVG anyway.
const SIZE = 1000;

// No 0/1/i/l/o: the code is normally machine-read, but it is short enough to be read off a
// card and retyped, and the same reasoning already governs generatePassword() in the admin.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODE_LENGTH = 4;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

// randomInt rather than randomBytes + %: 256 does not divide 31, so the modulo version
// would quietly favour the front of the alphabet. Same line count, no bias.
function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

const isCode = (value) => typeof value === 'string' && CODE_PATTERN.test(value);

const scanUrl = (code) => `${QR_BASE_URL()}/${code}`;

// Destinations are admin-entered, so this is not guarding against an open redirect -- it is
// keeping javascript: and data: out of a Location header, and catching the typo where
// someone pastes a bare domain with no scheme.
function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// Uploaded on every render rather than uploaded once and remembered. Monkey publishes no
// retention guarantee for /qr/uploadImage, and the failure mode of a stale handle is not an
// error -- it is a 200 with a hole in the middle of a QR that may already be at the printer.
// One extra 36KB POST per code generated is the cheaper side of that trade.
async function uploadMark() {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(MARK)], { type: 'image/png' }), 'qr-mark.png');

  const res = await fetch(`${MONKEY_BASE}/qr/uploadImage`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`logo upload failed (${res.status})`);

  const { file } = await res.json();
  if (!file) throw new Error('logo upload returned no file handle');
  return file;
}

// Returns { buffer, contentType, extension } for 'png' or 'svg'.
async function renderQr(code, format) {
  if (format !== 'png' && format !== 'svg') throw new Error(`unsupported format: ${format}`);

  const logo = await uploadMark();
  const res = await fetch(`${MONKEY_BASE}/qr/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: scanUrl(code),
      config: { ...STYLE, logo },
      size: SIZE,
      file: format,
    }),
  });
  if (!res.ok) throw new Error(`QR render failed (${res.status})`);

  // Monkey answers a malformed request with a 200 and an HTML page, so status alone is not
  // proof of an image. Without this the admin would download a .png full of markup.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('QR render returned something that is not an image');

  return { buffer: Buffer.from(await res.arrayBuffer()), contentType, extension: format };
}

// "Sipho's Barber - table tent" -> "siphos-barber-table-tent-a7f3.png". The code is kept in
// the filename so a file found on disk months later can still be traced back to its row.
function qrFilename(label, code, extension) {
  const slug = String(label || 'qr')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'qr'}-${code}.${extension}`;
}

module.exports = { generateCode, isCode, scanUrl, isHttpUrl, renderQr, qrFilename, ALPHABET, CODE_LENGTH };
