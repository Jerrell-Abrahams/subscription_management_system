const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ponytail: resend.dev only delivers to the Resend account's own email until a domain is
// verified. That is fine today -- the only mail this system sends is the daily digest, and
// it goes to exactly that address. Swap this for 'Complex AI <billing@complexai.co.za>'
// (and add the Resend DNS records at Host Africa) the day anything is sent to a customer.
const FROM = 'Complex AI <onboarding@resend.dev>';

// The Resend account owner. Every email this system sends goes here and nowhere else.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jerrellabrahams50@gmail.com';

// Throws on failure. Callers decide whether that is fatal -- the cron logs it into the
// next digest rather than dying, an interactive route would surface it.
async function send({ to, subject, html }) {
  const { error } = await resend.emails.send({ from: FROM, to: to || ADMIN_EMAIL, subject, html });
  if (error) throw new Error(error.message);
}

module.exports = { send, ADMIN_EMAIL };
