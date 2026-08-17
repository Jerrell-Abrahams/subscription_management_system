// Add-on modules a subscription grants, carried to the device inside the signed licence
// certificate. The consuming app gates whole feature areas on these, so the claim is the only
// thing standing between a customer and a module they haven't paid for -- a flag in the app's own
// local database would be one the customer could flip.
//
// Same shape as superUserClaim in superUserCode.js: an ABSENT claim is the default and means no
// modules. That's what keeps every existing subscription, and every app version that predates a
// given module, unaffected by this.

// Modules the platform knows how to sell, per product slug. Kept here rather than free text so a
// typo in the admin UI can't silently produce a module the app will never recognise -- the app
// matches these slugs exactly and ignores anything else.
const PRODUCT_MODULES = {
  'pos-system': [{ slug: 'wholesale', label: 'Wholesaler' }],
};

function modulesForProduct(productSlug) {
  return PRODUCT_MODULES[productSlug] || [];
}

// Returns the claim to embed, or undefined when the subscription grants nothing -- keeps the
// certificate payload unchanged for the overwhelming majority of subscriptions.
function modulesClaim(subscription) {
  const modules = subscription && subscription.modules;
  if (!Array.isArray(modules)) return undefined;
  const cleaned = [...new Set(modules.map((m) => String(m).trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : undefined;
}

module.exports = { modulesClaim, modulesForProduct, PRODUCT_MODULES };
