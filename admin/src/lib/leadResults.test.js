// Run by the root npm test (node --test). Pure functions, no react, no supabase.
import test from 'node:test';
import assert from 'node:assert';
import { readSavedResults, saveResults, freshnessLabel, RESULTS_KEY } from './leadResults.js';

// Smallest thing that behaves like localStorage, plus a switch to make it throw the way a
// quota error or a blocked-storage browser does.
function fakeStorage(initial = {}, { throwing = false } = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(k) {
      if (throwing) throw new Error('storage disabled');
      return k in data ? data[k] : null;
    },
    setItem(k, v) {
      if (throwing) throw new Error('quota exceeded');
      data[k] = v;
    },
    removeItem(k) {
      if (throwing) throw new Error('storage disabled');
      delete data[k];
    },
  };
}

test('nothing saved reads as empty', () => {
  assert.deepStrictEqual(readSavedResults(fakeStorage()), { at: null, results: [] });
});

test('a saved search round-trips', () => {
  const storage = fakeStorage();
  const payload = { at: '2026-08-18T10:00:00.000Z', results: [{ name: 'Acme Plumbing' }] };
  saveResults(storage, payload);
  assert.deepStrictEqual(readSavedResults(storage), payload);
});

// The failure this exists for: a write interrupted by a tab close leaves half a JSON
// document behind. Parsing it during render would blank the page, with no error boundary.
test('a truncated value is dropped rather than thrown', () => {
  const storage = fakeStorage({ [RESULTS_KEY]: '{"at":"2026-08-18","results":[{"name":"Acme' });
  assert.deepStrictEqual(readSavedResults(storage), { at: null, results: [] });
  assert.strictEqual(RESULTS_KEY in storage.data, false, 'the bad value should be cleared');
});

test('valid JSON of the wrong shape is dropped too', () => {
  for (const bad of ['null', '"a string"', '{"results":"not an array"}', '[]', '42']) {
    const storage = fakeStorage({ [RESULTS_KEY]: bad });
    assert.deepStrictEqual(readSavedResults(storage), { at: null, results: [] }, `for ${bad}`);
  }
});

test('a saved search with no timestamp still returns its results', () => {
  const storage = fakeStorage({ [RESULTS_KEY]: JSON.stringify({ results: [{ name: 'Acme' }] }) });
  assert.deepStrictEqual(readSavedResults(storage), { at: null, results: [{ name: 'Acme' }] });
});

test('clearing the results removes the key instead of storing an empty list', () => {
  const storage = fakeStorage();
  saveResults(storage, { at: '2026-08-18T10:00:00.000Z', results: [{ name: 'Acme' }] });
  saveResults(storage, { at: null, results: [] });
  assert.strictEqual(RESULTS_KEY in storage.data, false);
});

test('storage being unavailable never throws', () => {
  const storage = fakeStorage({}, { throwing: true });
  assert.deepStrictEqual(readSavedResults(storage), { at: null, results: [] });
  assert.doesNotThrow(() => saveResults(storage, { at: null, results: [{ name: 'Acme' }] }));
});

test('ages read the way a person would say them', () => {
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const minute = 60 * 1000;
  assert.strictEqual(freshnessLabel(ago(0)), 'just now');
  assert.strictEqual(freshnessLabel(ago(20 * minute)), '20 minutes ago');
  assert.strictEqual(freshnessLabel(ago(60 * minute)), '1 hour ago');
  assert.strictEqual(freshnessLabel(ago(5 * 60 * minute)), '5 hours ago');
  assert.strictEqual(freshnessLabel(ago(24 * 60 * minute)), '1 day ago');
  assert.strictEqual(freshnessLabel(ago(3 * 24 * 60 * minute)), '3 days ago');
});

// null is the one that bites: new Date(null) is the epoch rather than an invalid date, so
// a missing timestamp reads as decades old unless it is guarded separately.
test('a missing or unparseable timestamp degrades to "just now"', () => {
  for (const bad of ['not a date', null, undefined, '']) {
    assert.strictEqual(freshnessLabel(bad), 'just now', `for ${JSON.stringify(bad)}`);
  }
});

test('a timestamp from the future reads as just now, not a negative age', () => {
  assert.strictEqual(freshnessLabel(new Date(Date.now() + 60 * 60 * 1000).toISOString()), 'just now');
});
