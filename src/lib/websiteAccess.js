// A website serves only while its subscription is active AND inside its paid period.
// Kept separate from the route so the access decision is unit-testable without a DB.
// past_due (suspended by an admin), expired (cron), canceled, revoked -> all block.
function isActive(subscription) {
  return (
    !!subscription &&
    subscription.status === 'active' &&
    new Date(subscription.current_period_end).getTime() > Date.now()
  );
}

// Reduce whatever we're handed -- a Host header ("example.com:443"), a pasted URL
// ("https://Example.com/path") -- to a bare lowercase hostname, so the value stored
// on insert and the value looked up per request are the same shape.
function normalizeDomain(input) {
  if (!input) return '';
  return String(input)
    .trim()
    .replace(/^https?:\/\//i, '') // strip scheme
    .split('/')[0] // strip path
    .split(':')[0] // strip port
    .toLowerCase();
}

module.exports = { isActive, normalizeDomain };
