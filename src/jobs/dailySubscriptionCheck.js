const cron = require('node-cron');
const supabase = require('../config/supabase');
const { upcomingPeriod, defaultAmount, documentNumber, LEAD_DAYS } = require('../lib/invoices');
const { digest } = require('../lib/emailTemplates');
const { send } = require('../lib/email');

// Whatever the customer would recognise as themselves on a list.
const customerName = (user) => user?.company_name || user?.full_name || user?.email || 'Unknown customer';

// The joined shape every digest section needs. One string, so the four queries below can't
// each pick a different set of columns and drift apart.
const SUBSCRIPTION_FIELDS = 'id, current_period_end, app_users(email, full_name, company_name), products(name), websites(domain)';

const describe = (s) => ({
  customer: customerName(s.app_users),
  product: s.products?.name || 'Subscription',
  endsAt: s.current_period_end,
  // A subscription has at most one website; websites(domain) comes back as an array.
  domain: s.websites?.[0]?.domain || null,
});

// Returns what it just expired, so the digest doesn't have to guess at a "changed in the
// last 24 hours" window -- the run knows, because the run did it.
async function expireStaleSubscriptions(errors = []) {
  const now = new Date().toISOString();

  // Two round trips rather than embedding the joins in the update's returning clause:
  // the rows are already written by then, and a plain select is the shape every other
  // query here uses.
  const { data: expired, error } = await supabase
    .from('subscriptions')
    .update({ status: 'expired' })
    .lt('current_period_end', now)
    .eq('status', 'active')
    .select('id');
  if (error) {
    console.error('[dailySubscriptionCheck] failed to expire subscriptions:', error.message);
    errors.push(`Could not expire lapsed subscriptions: ${error.message}`);
    return [];
  }
  if (!expired?.length) return [];

  const { data: details, error: detailsError } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_FIELDS)
    .in('id', expired.map((s) => s.id));
  // The update has already landed by this point, so losing this select loses the only
  // record that sites went offline tonight -- and on an otherwise quiet day the digest
  // would send nothing at all, which reads as "all clear".
  if (detailsError) {
    errors.push(`${expired.length} subscription(s) expired but could not be described: ${detailsError.message}`);
    return [];
  }
  return (details || []).map(describe);
}

// Drafts next period's invoice LEAD_DAYS before the current one runs out. Drafts only --
// amounts are negotiated per customer and typed in by hand, so nothing is sent unattended;
// this exists so an invoice is never simply forgotten.
async function draftUpcomingInvoices(errors = []) {
  const now = new Date();
  const horizon = new Date(now.getTime() + LEAD_DAYS * 86400000);

  // Only subscriptions still inside their period: expireStaleSubscriptions has already
  // run above, and billing a lapsed subscription for a period nobody asked to renew
  // would be worse than missing it.
  const { data: subscriptions, error } = await supabase
    .from('subscriptions')
    .select('id, billing_interval, current_period_end')
    .in('status', ['active', 'past_due'])
    .gte('current_period_end', now.toISOString())
    .lte('current_period_end', horizon.toISOString());
  if (error) {
    console.error('[dailySubscriptionCheck] failed to load renewals due:', error.message);
    errors.push(`Could not load renewals due: ${error.message}`);
    return;
  }

  for (const subscription of subscriptions || []) {
    const { periodStart, periodEnd } = upcomingPeriod(subscription);

    const { data: prior } = await supabase
      .from('invoices')
      .select('amount, status')
      .eq('subscription_id', subscription.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const { error: insertError } = await supabase.from('invoices').insert({
      subscription_id: subscription.id,
      amount: defaultAmount(prior),
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      due_date: periodStart.toISOString().slice(0, 10),
    });

    // 23505 = invoices_subscription_period_idx. Expected on every run after the first
    // for the same period, and the reason this job is safe to re-run or run twice a day.
    if (insertError && insertError.code !== '23505') {
      console.error(
        `[dailySubscriptionCheck] failed to draft invoice for subscription ${subscription.id}:`,
        insertError.message
      );
      errors.push(`Could not draft invoice for subscription ${subscription.id}: ${insertError.message}`);
    }
  }
}

// The three reads the digest needs that the run doesn't already know. Failures are pushed
// into `errors` rather than thrown: a broken leads query must not cost you the overdue
// invoice list in the same email.
async function collectDigest(errors) {
  const today = new Date().toLocaleDateString('sv'); // local calendar date, as in format.js
  const horizon = new Date(Date.now() + LEAD_DAYS * 86400000).toISOString();

  const [invoices, expiring, leads] = await Promise.all([
    supabase
      .from('invoices')
      .select('number, amount, due_date, subscriptions(app_users(email, full_name, company_name))')
      .eq('status', 'sent')
      .lt('due_date', today)
      .order('due_date'),
    supabase
      .from('subscriptions')
      .select(SUBSCRIPTION_FIELDS)
      // Same statuses draftUpcomingInvoices bills. A past_due subscription still gets an
      // invoice raised for next period, so it has to appear here too -- otherwise the one
      // customer you already suspended is the one the digest never mentions.
      .in('status', ['active', 'past_due'])
      .gte('current_period_end', new Date().toISOString())
      .lte('current_period_end', horizon)
      .order('current_period_end'),
    supabase
      .from('leads')
      .select('name, follow_up_date')
      .eq('status', 'follow_up')
      .lte('follow_up_date', today)
      .order('follow_up_date'),
  ]);

  for (const [label, result] of [['overdue invoices', invoices], ['expiring subscriptions', expiring], ['lead follow-ups', leads]]) {
    if (result.error) errors.push(`Could not read ${label}: ${result.error.message}`);
  }

  return {
    today,
    overdue: (invoices.data || []).map((i) => ({
      number: documentNumber('invoice', i.number),
      amount: i.amount,
      dueDate: i.due_date,
      customer: customerName(i.subscriptions?.app_users),
    })),
    expiring: (expiring.data || []).map(describe),
    followUps: (leads.data || []).map((l) => ({ name: l.name, followUpDate: l.follow_up_date })),
  };
}

async function run() {
  const errors = [];
  const wentDark = await expireStaleSubscriptions(errors);
  await draftUpcomingInvoices(errors);

  const mail = digest({ ...(await collectDigest(errors)), wentDark, errors });
  // null = nothing to report and nothing broke. Silence is the signal.
  if (!mail) return;

  try {
    await send(mail);
  } catch (err) {
    // Nowhere left to report to -- the reporting channel is what failed.
    console.error('[dailySubscriptionCheck] failed to send digest:', err.message);
  }
}

// Keep the hour in step with the cron in vercel.json. This is the same job on the
// non-Vercel path, so letting them drift means the digest lands at a different time
// depending on where it happens to be running.
function start() {
  cron.schedule('0 4 * * *', run);
}

module.exports = { start, run, expireStaleSubscriptions, draftUpcomingInvoices, collectDigest };
