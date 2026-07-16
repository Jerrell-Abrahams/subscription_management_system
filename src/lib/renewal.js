// Extends from the current period end if it's still in the future (early
// renewal stacks time), otherwise from now (lapsed renewal doesn't backdate).
function nextPeriodEnd(currentPeriodEnd, billingInterval, now = new Date()) {
  const current = new Date(currentPeriodEnd);
  const base = current > now ? current : new Date(now);
  base.setMonth(base.getMonth() + (billingInterval === 'yearly' ? 12 : 1));
  return base;
}

module.exports = { nextPeriodEnd };
