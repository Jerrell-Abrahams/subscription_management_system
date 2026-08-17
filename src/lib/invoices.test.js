const test = require('node:test');
const assert = require('node:assert');
const {
  upcomingPeriod,
  documentNumber,
  linePeriod,
  defaultAmount,
  paymentReference,
  billToLines,
  lineDescription,
  formatMoney,
} = require('./invoices');

test('the invoice covers the period starting where the current one ends', () => {
  const { periodStart, periodEnd } = upcomingPeriod({
    current_period_end: '2026-09-01T00:00:00.000Z',
    billing_interval: 'monthly',
  });
  assert.strictEqual(periodStart.toISOString().slice(0, 10), '2026-09-01');
  assert.strictEqual(periodEnd.toISOString().slice(0, 10), '2026-10-01');
});

test('yearly subscriptions bill a year at a time', () => {
  const { periodEnd } = upcomingPeriod({
    current_period_end: '2026-09-01T00:00:00.000Z',
    billing_interval: 'yearly',
  });
  assert.strictEqual(periodEnd.toISOString().slice(0, 10), '2027-09-01');
});

test('invoice and receipt share a number, drafts have none', () => {
  assert.strictEqual(documentNumber('invoice', 10), 'INV-0010');
  assert.strictEqual(documentNumber('receipt', 10), 'RCT-0010');
  assert.strictEqual(documentNumber('invoice', null), 'DRAFT');
});

test('a draft copies the last real amount, skipping voids', () => {
  assert.strictEqual(
    defaultAmount([
      { status: 'void', amount: '9999.00' },
      { status: 'paid', amount: '750.00' },
      { status: 'paid', amount: '500.00' },
    ]),
    750
  );
});

test('the first invoice for a subscription has no amount to copy', () => {
  assert.strictEqual(defaultAmount([]), null);
  assert.strictEqual(defaultAmount([{ status: 'draft', amount: null }]), null);
});

test('the payment reference is the customer, not the invoice number', () => {
  assert.strictEqual(paymentReference({ company_name: 'Corner Spaza', full_name: 'Thandi Nkosi' }, 'INV-0010'), 'Corner Spaza');
  assert.strictEqual(paymentReference({ full_name: 'Thandi Nkosi' }, 'INV-0010'), 'Thandi Nkosi');
  // Nothing on file still leaves a usable reference rather than an empty one.
  assert.strictEqual(paymentReference({ email: 'a@b.co.za' }, 'INV-0010'), 'INV-0010');
  assert.strictEqual(paymentReference(null, 'INV-0010'), 'INV-0010');
});

test('Bill To carries business, contact, address, and email+phone on one line', () => {
  assert.deepStrictEqual(
    billToLines({
      company_name: 'Corner Spaza',
      full_name: 'Thandi Nkosi',
      billing_address: '12 Main Rd\nParow',
      email: 'a@b.co.za',
      phone: '+27 21 000 0000',
    }),
    ['Corner Spaza', 'Thandi Nkosi', '12 Main Rd', 'Parow', 'a@b.co.za · +27 21 000 0000']
  );
});

test('Bill To collapses blank fields instead of leaving gaps', () => {
  assert.deepStrictEqual(
    billToLines({ company_name: 'Corner Spaza', full_name: null, billing_address: '12 Main Rd\nParow', email: 'a@b.co.za' }),
    ['Corner Spaza', '12 Main Rd', 'Parow', 'a@b.co.za']
  );
  assert.deepStrictEqual(billToLines({ email: 'a@b.co.za' }), ['a@b.co.za']);
  assert.deepStrictEqual(billToLines(null), []);
});

test('the line item names the product and the interval', () => {
  assert.strictEqual(
    lineDescription({ products: { name: 'POS System' }, billing_interval: 'monthly' }),
    'POS System — Monthly subscription'
  );
  assert.strictEqual(
    lineDescription({ products: { name: 'Website' }, billing_interval: 'yearly' }),
    'Website — Annual subscription'
  );
});

test('the period column drops a repeated year but keeps a straddled one', () => {
  // Month spelling is ICU's business (en-ZA says "Sept", not "Sep"), so assert the
  // year handling rather than the exact glyphs, or this breaks on a Node upgrade.
  const sameYear = linePeriod('2026-08-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z');
  assert.strictEqual(sameYear.match(/2026/g).length, 1);
  assert.match(sameYear, / – .*2026$/);

  const straddling = linePeriod('2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
  assert.match(straddling, /2026 – .*2027$/);
});

test('amounts render as rands, SA convention: space thousands, comma decimal', () => {
  // \s rather than a literal space: toLocaleString groups with U+00A0.
  assert.match(formatMoney(1750.5), /^R\s1\s750,50$/);
  assert.strictEqual(formatMoney(0), 'R 0,00');
});
