const test = require('node:test');
const assert = require('node:assert');
const { isActive, normalizeDomain } = require('./websiteAccess');

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

test('active and inside period serves', () => {
  assert.strictEqual(isActive({ status: 'active', current_period_end: future }), true);
});

test('active but period lapsed does not serve', () => {
  assert.strictEqual(isActive({ status: 'active', current_period_end: past }), false);
});

test('past_due (admin-suspended) does not serve even inside period', () => {
  assert.strictEqual(isActive({ status: 'past_due', current_period_end: future }), false);
});

test('revoked does not serve', () => {
  assert.strictEqual(isActive({ status: 'revoked', current_period_end: future }), false);
});

test('missing subscription does not serve', () => {
  assert.strictEqual(isActive(null), false);
});

test('normalizeDomain strips scheme, path, port and lowercases', () => {
  assert.strictEqual(normalizeDomain('https://Example.com/pricing'), 'example.com');
  assert.strictEqual(normalizeDomain('example.com:443'), 'example.com');
  assert.strictEqual(normalizeDomain('  Sub.Example.CO.UK  '), 'sub.example.co.uk');
  assert.strictEqual(normalizeDomain(''), '');
  assert.strictEqual(normalizeDomain(undefined), '');
});
