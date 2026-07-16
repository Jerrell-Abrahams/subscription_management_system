const test = require('node:test');
const assert = require('node:assert');
const { nextPeriodEnd } = require('./renewal');

const now = new Date('2026-07-16T12:00:00Z');

test('future period end extends from the period end, not from now', () => {
  const result = nextPeriodEnd('2026-08-10T00:00:00Z', 'monthly', now);
  assert.strictEqual(result.toISOString(), '2026-09-10T00:00:00.000Z');
});

test('lapsed period end extends from now', () => {
  const result = nextPeriodEnd('2026-06-01T00:00:00Z', 'monthly', now);
  assert.strictEqual(result.toISOString(), '2026-08-16T12:00:00.000Z');
});

test('yearly adds 12 months', () => {
  const result = nextPeriodEnd('2026-08-10T00:00:00Z', 'yearly', now);
  assert.strictEqual(result.toISOString(), '2027-08-10T00:00:00.000Z');
});
