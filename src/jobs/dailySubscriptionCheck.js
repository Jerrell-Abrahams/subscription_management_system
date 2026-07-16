const cron = require('node-cron');
const supabase = require('../config/supabase');

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

function start() {
  cron.schedule('0 0 * * *', expireStaleSubscriptions);
}

module.exports = { start, expireStaleSubscriptions };
