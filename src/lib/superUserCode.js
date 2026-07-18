const { randomBytes, scryptSync } = require('crypto');

// The super user code lets support staff sign into a customer's POS. The POS has to
// check it while offline (that's the whole point -- it's used on tills whose licence
// has lapsed or whose network is down), so the check has to travel to the device.
//
// It travels as a scrypt hash inside the signed licence certificate, NEVER as the
// code itself: that certificate is a plain JWT sitting in the customer's SQLite
// `settings` table, and its payload is base64, not encrypted. Anyone who opens their
// own database file can read every field in it. A hash means that only buys them an
// offline cracking problem instead of the code.
//
// Params are pinned rather than left to Node's defaults so that the POS derives the
// same key as this server even if the two run different Node versions -- a silent
// mismatch here would look like "the code just stopped working".
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

function deriveKey(code, salt) {
  return scryptSync(code, salt, KEY_LENGTH, SCRYPT_PARAMS);
}

// Returns the claim to embed in a certificate, or undefined when the subscription has
// no code set -- an absent claim is how the POS knows super access isn't available.
function superUserClaim(subscription) {
  const code = subscription && subscription.super_user_code;
  if (!code) return undefined;
  const salt = randomBytes(16).toString('base64');
  return { salt, hash: deriveKey(code, salt).toString('base64') };
}

// select('*') on subscriptions pulls super_user_code along with everything else, and
// these rows get returned to the authenticated *customer*. Without this the code would
// ship to every customer in plaintext in the /activate and /status response bodies,
// which would defeat hashing it into the certificate in the first place.
function publicSubscription(subscription) {
  if (!subscription) return subscription;
  const { super_user_code: _omitted, ...rest } = subscription;
  return rest;
}

module.exports = { superUserClaim, publicSubscription, deriveKey, KEY_LENGTH, SCRYPT_PARAMS };
