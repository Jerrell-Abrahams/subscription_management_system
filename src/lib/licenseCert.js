const jwt = require('jsonwebtoken');

// Separate signing key from JWT_SECRET (the API-session HS256 secret) -- this
// is a client-verifiable RS256 certificate, embedded as a public key in the
// consuming apps, so it must use asymmetric signing.
function loadPrivateKey() {
  const raw = process.env.LICENSE_CERT_PRIVATE_KEY || '';
  // supports both a real multiline .env value and a single-line "\n"-escaped
  // one (common on hosting UIs that don't accept multiline env values)
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function signCertificate(payload) {
  return jwt.sign(payload, loadPrivateKey(), { algorithm: 'RS256' });
}

module.exports = { signCertificate };
