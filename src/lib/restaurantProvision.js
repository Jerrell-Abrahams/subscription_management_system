// Calls the restaurant repo's POST /api/platform/provision, right after this project creates
// the billing subscription for a new "restaurant" product. That endpoint creates the owner's
// real login -- a Supabase Auth account, in a DIFFERENT Supabase project entirely -- plus the
// restaurant row itself, and is the only way that login gets created outside a manual SQL
// insert. See src/routes/admin.js for the caller and docs in the restaurant repo's
// src/routes/platform.js for the other side.
//
// Idempotent on subscriptionId there, so this can simply be called again on failure -- no retry
// bookkeeping needed here.
async function provisionRestaurant({ subscriptionId, email, password, fullName, restaurantName, slug, googlePlaceId }) {
  const base = process.env.RESTAURANT_API_URL;
  const secret = process.env.RESTAURANT_API_SECRET;
  if (!base || !secret) {
    throw new Error('RESTAURANT_API_URL/RESTAURANT_API_SECRET are not configured');
  }

  const res = await fetch(`${base}/api/platform/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-provision-secret': secret },
    body: JSON.stringify({ subscriptionId, email, password, fullName, restaurantName, slug, googlePlaceId }),
    signal: AbortSignal.timeout(8000), // creates an Auth user + two rows; a hung restaurant API must not hang this request forever
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Restaurant API returned unreadable JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(body.error || `Restaurant API returned ${res.status}`);
  }
  return body;
}

module.exports = { provisionRestaurant };
