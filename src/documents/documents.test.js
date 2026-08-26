const test = require('node:test');
const assert = require('node:assert');
const { TEMPLATES, templateText, listTemplates, documentBlocks, documentFilename, defaultRef, withRef } = require('./index');
const { VARIABLES, BLANK, varsIn, fill, fieldsFor } = require('./variables');
const { parse, plain } = require('./markdown');

// The content layer only. No pdfkit, no supabase, no filesystem beyond the templates
// themselves -- these checks are the ones worth running on every commit, because the way
// this system breaks is a clause edited in a .md file, not a bug in the renderer.

const textOf = (slug) => templateText(slug);
const allText = () => TEMPLATES.map((t) => [t.slug, textOf(t.slug)]);

test('every placeholder used by a template is defined in the registry', () => {
  for (const [slug, text] of allText()) {
    for (const name of varsIn(text)) {
      assert.ok(VARIABLES[name], `${slug} uses {{${name}}}, which variables.js does not define`);
    }
  }
});

test('no placeholder survives rendering, filled or not', () => {
  for (const [slug, text] of allText()) {
    assert.doesNotMatch(fill(text, {}, {}), /\{\{/, `${slug} left a raw placeholder behind`);
  }
});

test('an unfilled placeholder becomes a visible blank, never an empty string', () => {
  const out = fill('Client: {{CLIENT_LEGAL_NAME}}.', {}, {});
  assert.strictEqual(out, `Client: ${BLANK}.`);
});

test('a placeholder with a default falls back to it rather than to a blank', () => {
  assert.match(fill('{{PAYMENT_TERMS}}', {}, {}), /30 days/);
  assert.match(fill('{{GOVERNING_LAW}}', {}, {}), /South Africa/);
});

test('business details come from settings and never appear as form fields', () => {
  const filled = fill('{{COMPANY_NAME}}', {}, { business_name: 'Complex AI' });
  assert.strictEqual(filled, 'Complex AI');
  for (const [slug, text] of allText()) {
    const names = fieldsFor(text).map((f) => f.name);
    assert.ok(!names.includes('COMPANY_NAME'), `${slug} should not ask for the business name`);
  }
});

test('money and dates print the way the invoices print them', () => {
  assert.match(fill('{{MONTHLY_FEE}}', { MONTHLY_FEE: '2500' }, {}), /^R\s?2\s?500[.,]00$/);
  assert.match(fill('{{START_DATE}}', { START_DATE: '2026-09-01' }, {}), /2026/);
  // Not every payment column is a number. "On acceptance" must survive untouched.
  assert.strictEqual(fill('{{MONTHLY_FEE}}', { MONTHLY_FEE: 'On acceptance' }, {}), 'On acceptance');
});

test('the documents reference each other in the right direction', () => {
  const t = Object.fromEntries(allText());
  assert.match(t['service-schedule'], /Master Client Services Agreement/);
  assert.match(t['statement-of-work'], /Master Client Services Agreement/);
  assert.match(t['statement-of-work'], /Service Schedule/);
  assert.match(t['change-request'], /Statement of Work/);
  assert.match(t['data-processing'], /Master Client Services Agreement/);
  // And the Master Agreement knows about the documents that hang off it.
  for (const name of ['Statement of Work', 'Service Schedule', 'Change Request', 'Data Processing Agreement']) {
    assert.ok(t['master-agreement'].includes(name), `master agreement never mentions a ${name}`);
  }
});

// The failure this guards against is a Schedule or SOW quietly inventing its own due date,
// leaving two documents that say different things about when the client has to pay.
//
// Standalone templates are exempt by definition: nothing sits above them, so they have to
// state their own terms. The rule is "a document that hangs off the master agreement must
// defer to it", not "only the master agreement may mention payment".
test('a document that hangs off the master agreement never sets its own payment terms', () => {
  for (const { slug, standalone } of TEMPLATES) {
    if (slug === 'master-agreement' || standalone) continue;
    assert.ok(
      !varsIn(textOf(slug)).includes('PAYMENT_TERMS'),
      `${slug} sets its own payment terms; it should defer to clause 6 of the master agreement`
    );
  }
  assert.ok(varsIn(textOf('master-agreement')).includes('PAYMENT_TERMS'));
});

// A standalone agreement is only safe if it is complete on its own -- it cannot lean on
// clauses that live in a document the client never signed.
test('a standalone agreement covers everything itself and points at nothing above it', () => {
  for (const { slug, standalone } of TEMPLATES) {
    if (!standalone) continue;
    const text = textOf(slug);
    assert.doesNotMatch(
      text,
      /of the Master Client Services Agreement/,
      `${slug} is standalone but defers to the master agreement, which the client has not signed`
    );
    for (const [topic, pattern] of [
      ['payment timing', /\{\{PAYMENT_TERMS\}\}/],
      ['ownership', /own/i],
      ['liability', /liabilit|responsib/i],
      ['termination', /ending this agreement|terminat/i],
      ['confidentiality', /private|confidential/i],
    ]) {
      assert.match(text, pattern, `${slug} is standalone but says nothing about ${topic}`);
    }
  }
});

test('every document that states fees also states the VAT position', () => {
  for (const [slug, text] of allText()) {
    if (!/South African Rand/.test(text)) continue;
    assert.match(text, /not currently a registered VAT vendor/, `${slug} states amounts without the VAT position`);
  }
});

test('nothing transfers Complex AI reusable technology by default', () => {
  const master = textOf('master-agreement');
  assert.match(master, /does not transfer ownership of this technology/i);
  assert.match(master, /pre-existing, reusable or general-purpose technology/i);
  // Transfer is possible, but only expressly and only once paid for.
  assert.match(master, /stated expressly in the applicable Statement of Work/i);
  assert.match(master, /paid in full/i);
  // The SOW must point back at that clause rather than inventing its own IP position.
  assert.match(textOf('statement-of-work'), /[Cc]lause 8 of the Master Client Services Agreement/);
});

test('no legislation is cited by section number', () => {
  for (const [slug, text] of allText()) {
    assert.doesNotMatch(text, /\bsection \d+/i, `${slug} cites a section number, which was not verified`);
    assert.doesNotMatch(text, /\bs\.? ?\d+ of the/i, `${slug} cites a section number, which was not verified`);
  }
});

test('POPIA roles use the statutory South African terms', () => {
  const dpa = textOf('data-processing');
  assert.match(dpa, /responsible party/i);
  assert.match(dpa, /operator/i);
  assert.doesNotMatch(dpa, /data controller/i);
  assert.doesNotMatch(dpa, /data processor/i);
});

test('every document carries attorney review markers and a review notes section', () => {
  for (const [slug, text] of allText()) {
    assert.match(text, /ATTORNEY REVIEW REQUIRED/, `${slug} has no review markers`);
    assert.match(text, /## Attorney Review Notes/, `${slug} has no review notes section`);
    assert.match(text, /\[\[REVIEW-NOTES\]\]/, `${slug} never splits off its review notes`);
    assert.match(text, /has not been certified/i, `${slug} does not disclaim certification`);
  }
});

test('the client copy drops the review markers and the review notes', () => {
  for (const { slug } of TEMPLATES) {
    const review = documentBlocks(slug, { reviewNotes: true });
    const client = documentBlocks(slug, { reviewNotes: false });
    assert.ok(client.length < review.length, `${slug} client copy is not shorter than the review copy`);

    const clientText = client.map((b) => plain(b.runs || []) + (b.items || []).map(plain).join(' ')).join('\n');
    assert.doesNotMatch(clientText, /ATTORNEY REVIEW REQUIRED/, `${slug} client copy still shows review markers`);
    assert.doesNotMatch(clientText, /Attorney Review Notes/, `${slug} client copy still shows the notes section`);
  }
});

test('every document ends with a signature block', () => {
  for (const { slug } of TEMPLATES) {
    const blocks = documentBlocks(slug, { reviewNotes: false });
    assert.ok(
      blocks.some((b) => b.type === 'signature'),
      `${slug} has nowhere to sign`
    );
  }
});

test('the catalogue exposes a field list built from the template text', () => {
  for (const t of listTemplates()) {
    assert.ok(t.fields.length > 0, `${t.slug} has no fields`);
    assert.ok(t.fields.every((f) => f.name && f.label && f.type));
    assert.ok(t.refPrefix && t.title && t.short);
  }
  const slugs = TEMPLATES.map((t) => t.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length, 'duplicate template slug');
});

test('filenames are readable and dated', () => {
  const name = documentFilename('master-agreement', { CLIENT_LEGAL_NAME: 'Acme Trading (Pty) Ltd' });
  assert.match(name, /^Master-Agreement-Acme-Trading-Pty-Ltd-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.match(documentFilename('change-request', {}), /^Change-Request-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('an unknown template is rejected rather than rendered empty', () => {
  assert.throws(() => templateText('not-a-document'), /Unknown document template/);
  assert.throws(() => documentBlocks('not-a-document'), /Unknown document template/);
});

// --- parser -------------------------------------------------------------------------

test('the parser recognises every block type the templates use', () => {
  const blocks = parse(
    [
      '# Title',
      '',
      '## 1. Parties',
      '',
      '### 1.1 Detail',
      '',
      'A **bold** word in a paragraph',
      'continued on the next line.',
      '',
      '- [ ] Website',
      '- [ ] SaaS',
      '',
      '- plain bullet',
      '',
      '1. first',
      '2. second',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '> ATTORNEY REVIEW REQUIRED: check this.',
      '',
      '---',
      '[[PAGEBREAK]]',
      '[[SIGNATURE]]',
    ].join('\n')
  );
  assert.deepStrictEqual(
    blocks.map((b) => b.type),
    ['h1', 'h2', 'h3', 'p', 'checklist', 'ul', 'ol', 'table', 'callout', 'rule', 'pagebreak', 'signature']
  );
});

test('a paragraph keeps its bold runs and joins its wrapped lines', () => {
  const [block] = parse('A **bold** word\ncontinued here.');
  assert.strictEqual(plain(block.runs), 'A bold word continued here.');
  assert.deepStrictEqual(
    block.runs.map((r) => r.bold),
    [false, true, false]
  );
});

test('a table drops its divider row and keeps head and body separate', () => {
  const [t] = parse('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.strictEqual(t.type, 'table');
  assert.deepStrictEqual(t.head.map(plain), ['A', 'B']);
  assert.deepStrictEqual(t.rows.map((r) => r.map(plain)), [['1', '2'], ['3', '4']]);
});

test('a label/value table with an empty header row parses without losing rows', () => {
  const [t] = parse('| | |\n|---|---|\n| Client | Acme |');
  assert.deepStrictEqual(t.head.map(plain), ['', '']);
  assert.deepStrictEqual(t.rows.map((r) => r.map(plain)), [['Client', 'Acme']]);
});

// The renderer labels a blockquote "ATTORNEY REVIEW REQUIRED" only when its text says so,
// and documentBlocks strips only those. A plain note added to a template must therefore
// survive into the client copy without acquiring a review banner.
test('an ordinary note is not treated as a review marker', () => {
  const blocks = parse('> Hosting fees are recharged at cost.');
  assert.strictEqual(blocks[0].type, 'callout');
  assert.doesNotMatch(plain(blocks[0].runs), /ATTORNEY REVIEW REQUIRED/);
});

// A table row is one line. A multi-line value in a cell ends the table at that row and
// dumps everything below it into a loose paragraph -- which is what a three-line address
// did to every party table in these documents.
test('a multi-line value inside a table row is flattened onto one line', () => {
  const filled = fill('| Address | {{CLIENT_ADDRESS}} |', { CLIENT_ADDRESS: '12 Long Street\nCape Town\n8001' }, {});
  assert.strictEqual(filled, '| Address | 12 Long Street, Cape Town, 8001 |');

  const [block] = parse(filled);
  assert.strictEqual(block.type, 'table');
  assert.deepStrictEqual(block.head.map(plain), ['Address', '12 Long Street, Cape Town, 8001']);
});

test('a party table survives a multi-line address without losing the rows under it', () => {
  const blocks = documentBlocks('master-agreement', {
    values: { CLIENT_ADDRESS: '12 Long Street\nCape Town\n8001' },
    settings: { address: '1 Example Road\nCape Town\n7500' },
  });
  const table = blocks.find((b) => b.type === 'table');
  // The Service Provider block is Name / Legal name / Address / Email / Telephone. Before
  // the fix the address cell truncated it to the rows above the address.
  const labels = table.rows.map((r) => plain(r[0]));
  for (const row of ['Address', 'Email', 'Telephone']) {
    assert.ok(labels.includes(row), `the ${row} row was lost when the address wrapped`);
  }
});

// Outside a table the opposite is true: newlines are how {{SCOPE}} becomes a bullet list.
test('a multi-line value outside a table still expands into real blocks', () => {
  const blocks = parse(fill('{{SCOPE}}', { SCOPE: '- One\n- Two' }, {}));
  assert.strictEqual(blocks[0].type, 'ul');
  assert.deepStrictEqual(blocks[0].items.map(plain), ['One', 'Two']);
});

test('a defaulted textarea renders as the list it is written as', () => {
  const blocks = parse(fill('{{MAINTENANCE_SCOPE}}', {}, {}));
  assert.strictEqual(blocks[0].type, 'ul', 'the maintenance default should render as bullets');
  assert.ok(blocks[0].items.length >= 3);
});

test('a multi-line value expands into real blocks', () => {
  const blocks = parse(fill('{{SCOPE}}', { SCOPE: '- One\n- Two' }, {}));
  assert.strictEqual(blocks[0].type, 'ul');
  assert.deepStrictEqual(blocks[0].items.map(plain), ['One', 'Two']);
});

test('the client copy leaves an unfilled field empty; the review copy marks it', () => {
  const forClient = documentBlocks('website-agreement', { values: {}, reviewNotes: false });
  const forAttorney = documentBlocks('website-agreement', { values: {}, reviewNotes: true });

  const clientText = forClient.map((b) => plain(b.runs || []) + (b.rows || []).flat().map((c) => plain(c)).join(' ')).join('\n');
  const attorneyText = forAttorney.map((b) => plain(b.runs || []) + (b.rows || []).flat().map((c) => plain(c)).join(' ')).join('\n');

  // Several fields are MEANT to be empty -- a client who is not VAT registered, a deal
  // with no backups. Printing [________] against those says a value is missing when none
  // was ever due, which is the whole reason the client copy passes ''.
  assert.doesNotMatch(clientText, /\[_+\]/, 'no ruled blanks on the copy that goes to the client');
  assert.match(attorneyText, /\[_+\]/, 'the review copy still shows you what is unfilled');
});

test('a filled field is identical on both copies', () => {
  const values = { CLIENT_LEGAL_NAME: 'Acme Trading (Pty) Ltd' };
  for (const reviewNotes of [true, false]) {
    const text = documentBlocks('website-agreement', { values, reviewNotes })
      .map((b) => (b.rows || []).flat().map((c) => plain(c)).join(' '))
      .join('\n');
    assert.match(text, /Acme Trading \(Pty\) Ltd/);
  }
});

test('blanking a value does not leave its punctuation behind', () => {
  // The party table pairs values inside parentheses and around a bullet. Substituting ''
  // for the second half of each would otherwise print "Jane Doe ()" and a trailing "·" on
  // a contract going to a client.
  const rows = documentBlocks('website-agreement', {
    values: { CLIENT_REPRESENTATIVE: 'Jane Doe', CLIENT_EMAIL: 'ops@acme.co.za' },
    reviewNotes: false,
  }).find((b) => b.type === 'table').rows.map((r) => r.map((c) => plain(c)));

  // Two rows are labelled Contact -- ours then the client's. The client's is the last.
  const cell = (label) => rows.filter((r) => r[0] === label).pop()[1];
  assert.equal(cell('Signing for the Client'), 'Jane Doe');
  assert.equal(cell('Contact'), 'ops@acme.co.za');
  assert.doesNotMatch(rows.flat().join('|'), /\(\s*\)|·\s*$|^\s*·/m);
});

test('a pair with both halves present keeps its separator', () => {
  const rows = documentBlocks('website-agreement', {
    values: { CLIENT_REPRESENTATIVE: 'Jane Doe', CLIENT_REP_CAPACITY: 'Director', CLIENT_EMAIL: 'a@b.co.za', CLIENT_PHONE: '021 555 0100' },
    reviewNotes: false,
  }).find((b) => b.type === 'table').rows.map((r) => r.map((c) => plain(c)));

  const cell = (label) => rows.filter((r) => r[0] === label).pop()[1];
  assert.equal(cell('Signing for the Client'), 'Jane Doe (Director)');
  assert.equal(cell('Contact'), 'a@b.co.za · 021 555 0100');
});

test('a blank reference is generated from the document, the date and the client', () => {
  const ref = defaultRef('website-agreement', { CLIENT_LEGAL_NAME: 'Acme Trading (Pty) Ltd' });
  assert.match(ref, /^WA-\d{8}-ACMETR$/);
  // Falls back to the trading name, and copes with having neither.
  assert.match(defaultRef('master-agreement', { CLIENT_NAME: 'Bo Kaap Deli' }), /^MCA-\d{8}-BOKAAP$/);
  assert.match(defaultRef('change-request', {}), /^CR-\d{8}$/, 'no client yet is still a usable reference');
});

test('a reference you typed yourself is never overwritten', () => {
  assert.equal(withRef('website-agreement', { DOCUMENT_REF: 'MINE-001' }).DOCUMENT_REF, 'MINE-001');
  // Blank and absent both mean "generate one" -- an empty string is what the form sends
  // for a field you never touched, so treating it as a typed value would print nothing.
  assert.match(withRef('website-agreement', {}).DOCUMENT_REF, /^WA-\d{8}$/);
  assert.match(withRef('website-agreement', { DOCUMENT_REF: '' }).DOCUMENT_REF, /^WA-\d{8}$/);
});

test('a money default is formatted like a typed one', () => {
  // HOURLY_RATE defaults to '250'. Printed raw it reads "250" in a column where every
  // other figure reads "R 250,00", which looks like a different kind of number.
  const typed = fill('{{HOURLY_RATE}}', { HOURLY_RATE: '250' });
  const defaulted = fill('{{HOURLY_RATE}}', {});
  assert.equal(defaulted, typed);
  assert.match(defaulted, /^R\s*250,00$/);
  // A prose default is not mangled on the way through the same path.
  assert.equal(fill('{{PAYMENT_TERMS}}', {}), '30 days from the date of invoice');
});
