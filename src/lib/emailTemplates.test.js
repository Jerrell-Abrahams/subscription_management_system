const test = require('node:test');
const assert = require('node:assert');
const { digest } = require('./emailTemplates');

const TODAY = '2026-08-17';

test('a quiet day sends nothing', () => {
  assert.equal(digest({ today: TODAY }), null);
});

test('an error sends even on an otherwise quiet day', () => {
  const mail = digest({ errors: ['resend: rate limited'], today: TODAY });
  assert.ok(mail, 'silence must not be ambiguous between "nothing to do" and "the job died"');
  assert.match(mail.subject, /1 error/);
  assert.match(mail.html, /rate limited/);
});

test('overdue invoices carry amount, customer and day count', () => {
  const mail = digest({
    overdue: [{ number: 'INV-0014', amount: 750, customer: 'Corner Spaza', dueDate: '2026-08-12' }],
    today: TODAY,
  });
  assert.match(mail.html, /INV-0014/);
  // en-ZA decimal separator is a comma -- same string the invoice PDFs print.
  assert.match(mail.html, /R 750,00/);
  assert.match(mail.html, /5 days overdue/);
  assert.equal(mail.subject, '1 overdue — Complex AI');
});

test('one day late is singular', () => {
  const mail = digest({
    overdue: [{ number: 'INV-0015', amount: 1, customer: 'X', dueDate: '2026-08-16' }],
    today: TODAY,
  });
  assert.match(mail.html, /1 day overdue/);
});

test('empty sections are omitted, not rendered as headings', () => {
  const mail = digest({ followUps: [{ name: 'Bo Kaap Deli', followUpDate: '2026-08-17' }], today: TODAY });
  assert.match(mail.html, /Follow-ups due/);
  assert.doesNotMatch(mail.html, /Overdue invoices/);
  assert.doesNotMatch(mail.html, /Went dark/);
});

test('a website is named when the subscription that serves it lapses', () => {
  const mail = digest({
    wentDark: [{ customer: 'Corner Spaza', product: 'Website', domain: 'cornerspaza.co.za' }],
    today: TODAY,
  });
  assert.match(mail.html, /cornerspaza\.co\.za<\/strong> is now offline/);
});

test('names from Google Places survive the mail client intact', () => {
  const mail = digest({
    followUps: [{ name: 'Fish & Chips <Sea Point>', followUpDate: '2026-08-17' }],
    today: TODAY,
  });
  assert.match(mail.html, /Fish &amp; Chips &lt;Sea Point&gt;/);
  assert.doesNotMatch(mail.html, /<Sea Point>/, 'an unescaped < would eat the rest of the name');
});

test('subject counts every populated section', () => {
  const mail = digest({
    overdue: [{ number: 'INV-1', amount: 10, customer: 'A', dueDate: '2026-08-01' }],
    expiring: [{ customer: 'B', product: 'POS', endsAt: '2026-08-20' }],
    followUps: [{ name: 'C', followUpDate: '2026-08-17' }],
    today: TODAY,
  });
  assert.equal(mail.subject, '1 overdue · 1 expiring · 1 follow-up — Complex AI');
});

test('a domain renewing under a cancelled subscription is called out as money leaking', () => {
  const mail = digest({
    domains: [
      { domain: 'cornerspaza.co.za', renewsOn: '2026-09-01', note: 'expired', orphaned: true, customer: 'Corner Spaza' },
      { domain: 'complexai.co.za', renewsOn: '2026-09-10', note: 'internal', orphaned: false, customer: null },
    ],
    today: TODAY,
  });
  assert.match(mail.html, /Domains renewing \(2\)/);
  assert.match(mail.html, /Corner Spaza is no longer paying/);
  // The internal domain is listed but must not be dressed up as a leak. Asserted by
  // counting rather than by proximity: every section header links to admin.complexai.co.za,
  // so a regex spanning from "complexai.co.za" to "no longer paying" matches the heading.
  assert.match(mail.html, /complexai\.co\.za<\/strong> — renews 10 Sept 2026 · <span[^>]*>internal</);
  assert.equal(mail.html.match(/no longer paying/g).length, 1);
  assert.match(mail.subject, /2 domains/);
});

test('a renewal date already past reads as due, without claiming it renewed', () => {
  const mail = digest({
    domains: [{ domain: 'late.co.za', renewsOn: '2026-08-14', note: 'active', orphaned: false }],
    today: TODAY,
  });
  assert.match(mail.html, /was due 3 days ago/);
});

test('a domain the client renews themselves never reaches the digest', () => {
  // Null domain_renews_on is filtered out in the query, so an empty list here is the
  // whole contract -- the section must vanish rather than render an empty heading.
  const mail = digest({ domains: [], followUps: [{ name: 'Bo Kaap Deli', followUpDate: TODAY }], today: TODAY });
  assert.doesNotMatch(mail.html, /Domains renewing/);
  assert.doesNotMatch(mail.subject, /domain/);
});
