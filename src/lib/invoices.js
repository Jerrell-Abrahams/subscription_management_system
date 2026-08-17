const { nextPeriodEnd } = require('./renewal');

// Days before a subscription's period end that the nightly cron drafts its next invoice.
// Long enough for an EFT to clear before access lapses, short enough not to be forgotten.
const LEAD_DAYS = 7;

// ZAR only -- one country, one currency, nothing to configure.
const CURRENCY_SYMBOL = 'R';

function formatMoney(amount) {
  return `${CURRENCY_SYMBOL} ${Number(amount || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Billing is in advance: an invoice raised now covers the period that begins when the
// current one ends, so it reaches the customer before their access lapses.
//
// Deliberately routed through nextPeriodEnd rather than adding a month here, so the
// period printed on the invoice is exactly what renewing will actually set. That
// includes nextPeriodEnd's month-end drift (a 31 Jan end rolls to 3 Mar) -- billing the
// customer for a period the platform won't grant would be the worse of the two bugs.
function upcomingPeriod(subscription) {
  const periodStart = new Date(subscription.current_period_end);
  return {
    periodStart,
    periodEnd: nextPeriodEnd(periodStart, subscription.billing_interval, periodStart),
  };
}

// One identity, two documents: INV-0010 unpaid, RCT-0010 once it's settled.
function documentNumber(kind, number) {
  if (number == null) return 'DRAFT';
  return `${kind === 'receipt' ? 'RCT' : 'INV'}-${String(number).padStart(4, '0')}`;
}

function lineDescription(subscription) {
  const product = subscription.products?.name || 'Subscription';
  const interval = subscription.billing_interval === 'yearly' ? 'Annual' : 'Monthly';
  return `${product} — ${interval} subscription`;
}

// Its own column on the invoice, so it's its own string. The year is dropped from the
// start date when both fall in the same one -- "17 Aug – 17 Sept 2026" rather than
// repeating 2026 twice in a 200px column.
function linePeriod(periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const startText =
    start.getFullYear() === end.getFullYear()
      ? formatDate(start).replace(` ${start.getFullYear()}`, '')
      : formatDate(start);
  return `${startText} – ${formatDate(end)}`;
}

// The price memory. Expects rows newest-first; voided invoices are skipped because a
// voided amount is usually the typo you voided it for.
function defaultAmount(previousInvoices) {
  const prior = (previousInvoices || []).find((i) => i.status !== 'void' && i.amount != null);
  return prior ? Number(prior.amount) : null;
}

// What the customer types into their banking app. Their own business name rather than
// the invoice number: this is what lands on the bank statement, and "Corner Spaza" is
// recognisable there where "INV-0012" is a digit away from being unattributable. Falls
// back to the number only when there's no name on file at all.
function paymentReference(customer, fallback) {
  return customer?.company_name || customer?.full_name || fallback;
}

// Bill To: business, then who to speak to, then where they are, then how to reach them.
// Email and phone share the last line the way the design sets them. Blank fields collapse
// rather than leaving gaps, so a customer with only an email still renders a sane block.
// The first line is set larger by the renderer, so order here is load-bearing.
function billToLines(customer) {
  if (!customer) return [];
  const address = (customer.billing_address || '').split('\n').map((line) => line.trim());
  const contact = [customer.email, customer.phone].filter(Boolean).join(' · ');
  return [customer.company_name, customer.full_name, ...address, contact].filter(Boolean);
}

module.exports = {
  LEAD_DAYS,
  formatMoney,
  formatDate,
  upcomingPeriod,
  documentNumber,
  lineDescription,
  linePeriod,
  defaultAmount,
  paymentReference,
  billToLines,
};
