const express = require('express');
const supabase = require('../config/supabase');
const adminAuth = require('../middleware/adminAuth');
const { renderInvoicePdf } = require('../lib/invoicePdf');
const { loadSettings } = require('../lib/settings');
const { upcomingPeriod, defaultAmount, documentNumber } = require('../lib/invoices');

const router = express.Router();
router.use(adminAuth);

const BUCKET = 'invoices';

// The customer block the PDF needs, hanging off the subscription in one round trip.
const SUBSCRIPTION_SELECT =
  'id, billing_interval, current_period_end, products(name, slug), ' +
  'app_users(email, full_name, phone, company_name, billing_address)';
const INVOICE_SELECT = `*, subscriptions(${SUBSCRIPTION_SELECT})`;

async function signedUrl(path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl || null;
}

// Renders and files the PDF, returning its storage path. Named by document number rather
// than row id so a file pulled straight out of the bucket is still identifiable.
async function storeDocument(kind, invoice) {
  const subscription = invoice.subscriptions;
  // Read at render time, not cached: the PDF is immutable once written, so it has to
  // capture the business details as they stood the moment it was generated.
  const buffer = await renderInvoicePdf({
    kind,
    invoice,
    subscription,
    customer: subscription.app_users,
    settings: await loadSettings(),
  });
  const path = `${subscription.id}/${documentNumber(kind, invoice.number)}.pdf`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

async function loadInvoice(id) {
  return supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single();
}

// Manual "New invoice". Same row the nightly cron would have drafted, just early --
// which is why it collides with the cron's unique index rather than duplicating it.
router.post('/', async (req, res) => {
  const { subscriptionId, amount, description } = req.body;
  if (!subscriptionId) {
    return res.status(400).json({ error: 'subscriptionId is required' });
  }

  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_SELECT)
    .eq('id', subscriptionId)
    .single();
  if (subError || !subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  const { periodStart, periodEnd } = upcomingPeriod(subscription);

  const { data: prior } = await supabase
    .from('invoices')
    .select('amount, status')
    .eq('subscription_id', subscriptionId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      subscription_id: subscriptionId,
      amount: amount === undefined || amount === null || amount === '' ? defaultAmount(prior) : Number(amount),
      description: description || null,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      // Payment is due the day the paid-up period runs out, which is the day the new one starts.
      due_date: periodStart.toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An invoice already exists for that period' });
    }
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json(data);
});

// The status filter is the immutability rule, enforced where it can't be raced: a sent
// invoice is already in the customer's hands, so editing it would let the PDF they hold
// and the row here quietly disagree. Correct one by voiding and reissuing instead.
router.patch('/:id', async (req, res) => {
  const { amount, description } = req.body;
  const { data, error } = await supabase
    .from('invoices')
    .update({
      ...(amount !== undefined && { amount: amount === '' || amount === null ? null : Number(amount) }),
      ...(description !== undefined && { description: description || null }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('status', 'draft')
    .select()
    .single();
  if (error) {
    return error.code === 'PGRST116'
      ? res.status(409).json({ error: 'Only a draft invoice can be edited' })
      : res.status(400).json({ error: error.message });
  }
  res.json(data);
});

router.post('/:id/send', async (req, res) => {
  const { data: invoice, error: loadError } = await loadInvoice(req.params.id);
  if (loadError || !invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  if (invoice.status !== 'draft') {
    return res.status(409).json({ error: `Invoice is already ${invoice.status}` });
  }
  if (!(Number(invoice.amount) > 0)) {
    return res.status(400).json({ error: 'Set an amount before sending' });
  }

  // Assigned here rather than at draft time so an abandoned draft doesn't burn a number.
  const { data: number, error: numberError } = await supabase.rpc('next_invoice_number');
  if (numberError) {
    return res.status(500).json({ error: numberError.message });
  }

  const sentAt = new Date().toISOString();
  let path;
  try {
    path = await storeDocument('invoice', { ...invoice, number, sent_at: sentAt });
  } catch (err) {
    return res.status(500).json({ error: `Could not store the PDF: ${err.message}` });
  }

  const { data, error } = await supabase
    .from('invoices')
    .update({ number, status: 'sent', sent_at: sentAt, pdf_path: path, updated_at: sentAt })
    .eq('id', invoice.id)
    .select()
    .single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ invoice: data, downloadUrl: await signedUrl(path) });
});

router.post('/:id/pay', async (req, res) => {
  const { paidAt, paymentReference } = req.body;
  const paid = paidAt ? new Date(paidAt) : new Date();
  if (Number.isNaN(paid.getTime())) {
    return res.status(400).json({ error: 'paidAt is invalid' });
  }

  const { data: invoice, error: loadError } = await loadInvoice(req.params.id);
  if (loadError || !invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  if (invoice.status !== 'sent') {
    return res.status(409).json({ error: `Only a sent invoice can be marked paid (this one is ${invoice.status})` });
  }

  const reference = paymentReference || null;
  let path;
  try {
    path = await storeDocument('receipt', {
      ...invoice,
      paid_at: paid.toISOString(),
      payment_reference: reference,
    });
  } catch (err) {
    return res.status(500).json({ error: `Could not store the receipt: ${err.message}` });
  }

  const { data, error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: paid.toISOString(),
      payment_reference: reference,
      receipt_pdf_path: path,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoice.id)
    .select()
    .single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ invoice: data, downloadUrl: await signedUrl(path) });
});

// Voiding keeps the row and its number, so the sequence still explains its own gaps.
// A paid invoice can't be voided -- that's a refund, and there's nothing to refund with yet.
router.post('/:id/void', async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    return res.status(400).json({ error: 'reason is required' });
  }

  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'void', void_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .in('status', ['draft', 'sent'])
    .select()
    .single();
  if (error) {
    return error.code === 'PGRST116'
      ? res.status(409).json({ error: 'Only a draft or sent invoice can be voided' })
      : res.status(400).json({ error: error.message });
  }
  res.json(data);
});

// Signed on demand rather than stored: a URL saved in the row would outlive its own
// expiry and turn into a dead link in the dashboard.
router.get('/:id/pdf', async (req, res) => {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('pdf_path, receipt_pdf_path')
    .eq('id', req.params.id)
    .single();
  if (error || !invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const path = req.query.doc === 'receipt' ? invoice.receipt_pdf_path : invoice.pdf_path;
  if (!path) {
    return res.status(404).json({ error: 'That document has not been generated yet' });
  }
  res.json({ downloadUrl: await signedUrl(path) });
});

module.exports = router;
