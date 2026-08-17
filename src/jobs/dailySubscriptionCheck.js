const cron = require('node-cron');
const supabase = require('../config/supabase');
const { upcomingPeriod, defaultAmount, LEAD_DAYS } = require('../lib/invoices');

async function expireStaleSubscriptions() {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'expired' })
    .lt('current_period_end', now)
    .eq('status', 'active');
  if (error) {
    console.error('[dailySubscriptionCheck] failed to expire subscriptions:', error.message);
  }
}

// Drafts next period's invoice LEAD_DAYS before the current one runs out. Drafts only --
// amounts are negotiated per customer and typed in by hand, so nothing is sent unattended;
// this exists so an invoice is never simply forgotten.
async function draftUpcomingInvoices() {
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
    }
  }
}

async function run() {
  await expireStaleSubscriptions();
  await draftUpcomingInvoices();
}

function start() {
  cron.schedule('0 0 * * *', run);
}

module.exports = { start, run, expireStaleSubscriptions, draftUpcomingInvoices };
