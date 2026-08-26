const test = require('node:test');
const assert = require('node:assert');
const { generateCode, isCode, scanUrl, isHttpUrl, qrFilename, ALPHABET, CODE_LENGTH } = require('./qr');

test('generated codes only ever use the unambiguous alphabet', () => {
  for (let i = 0; i < 2000; i += 1) {
    const code = generateCode();
    assert.strictEqual(code.length, CODE_LENGTH);
    assert.ok(isCode(code), `${code} failed its own validator`);
  }
});

test('the alphabet excludes the characters people misread off a card', () => {
  for (const ch of '01ilo') assert.ok(!ALPHABET.includes(ch), `${ch} should not be in the alphabet`);
});

test('every alphabet character is reachable', () => {
  const seen = new Set();
  // 31 symbols over 4 positions: 20k draws makes a miss astronomically unlikely unless
  // generateCode is actually skipping part of the range.
  for (let i = 0; i < 20000; i += 1) for (const ch of generateCode()) seen.add(ch);
  assert.strictEqual(seen.size, ALPHABET.length);
});

test('isCode rejects the wrong length and the excluded characters', () => {
  assert.ok(!isCode('a7f'));
  assert.ok(!isCode('a7f3x'));
  assert.ok(!isCode('a7f0')); // 0 is not in the alphabet
  assert.ok(!isCode('A7F3')); // uppercase is a different code, not the same one
  assert.ok(!isCode(''));
  assert.ok(!isCode(undefined));
});

test('scanUrl builds the printed URL and tolerates a trailing slash on the base', () => {
  process.env.QR_BASE_URL = 'https://qr.complexai.co.za/';
  assert.strictEqual(scanUrl('a7f3'), 'https://qr.complexai.co.za/a7f3');
  delete process.env.QR_BASE_URL;
});

test('only http(s) destinations are accepted', () => {
  assert.ok(isHttpUrl('https://sipho-barber.co.za'));
  assert.ok(isHttpUrl('http://sipho-barber.co.za/menu?x=1'));
  // The two that matter: a scheme that must never reach a Location header, and the typo
  // where someone pastes a domain with no scheme at all.
  assert.ok(!isHttpUrl('javascript:alert(1)'));
  assert.ok(!isHttpUrl('sipho-barber.co.za'));
});

test('filenames slug the label and keep the code', () => {
  assert.strictEqual(qrFilename("Sipho's Barber - table tent", 'a7f3', 'png'), 'sipho-s-barber-table-tent-a7f3.png');
  assert.strictEqual(qrFilename('   ', 'a7f3', 'svg'), 'qr-a7f3.svg');
});
