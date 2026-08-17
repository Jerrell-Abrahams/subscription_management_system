const test = require('node:test');
const assert = require('node:assert');
const { modulesClaim, modulesForProduct } = require('./modules');

// An ABSENT claim is what every existing subscription produces, and what every consuming app
// treats as "no modules". These cases are the ones that keep this change invisible to the
// thousands of subscriptions that will never buy an add-on.
test('no modules column yet (older row) omits the claim', () => {
  assert.strictEqual(modulesClaim({}), undefined);
});

test('empty array omits the claim rather than sending []', () => {
  assert.strictEqual(modulesClaim({ modules: [] }), undefined);
});

test('missing subscription omits the claim', () => {
  assert.strictEqual(modulesClaim(null), undefined);
  assert.strictEqual(modulesClaim(undefined), undefined);
});

test('a non-array value is ignored rather than throwing mid-certificate', () => {
  assert.strictEqual(modulesClaim({ modules: 'wholesale' }), undefined);
  assert.strictEqual(modulesClaim({ modules: 7 }), undefined);
});

test('grants the modules the subscription carries', () => {
  assert.deepStrictEqual(modulesClaim({ modules: ['wholesale'] }), ['wholesale']);
});

test('trims stray whitespace so a hand-edited row still matches the app slug', () => {
  assert.deepStrictEqual(modulesClaim({ modules: ['  wholesale  '] }), ['wholesale']);
});

test('drops blanks and de-duplicates', () => {
  assert.deepStrictEqual(modulesClaim({ modules: ['wholesale', '', '  ', 'wholesale'] }), ['wholesale']);
});

// Case matters: the app compares slugs exactly and silently ignores what it doesn't recognise,
// so this is deliberately NOT lowercased here — it would only mask a wrong value in the database.
test('does not rewrite case', () => {
  assert.deepStrictEqual(modulesClaim({ modules: ['Wholesale'] }), ['Wholesale']);
});

test('lists sellable modules per product and nothing for other products', () => {
  assert.deepStrictEqual(
    modulesForProduct('pos-system').map((m) => m.slug),
    ['wholesale']
  );
  assert.deepStrictEqual(modulesForProduct('sam-website'), []);
  assert.deepStrictEqual(modulesForProduct(undefined), []);
});
