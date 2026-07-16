const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ponytail: resend.dev only delivers to the Resend account's own email until
// a domain is verified - swap this for e.g. 'License Platform <onboarding@yourdomain.com>'
// once one is set up.
const FROM = 'License Platform <onboarding@resend.dev>';
const SUPPORT_EMAIL = 'jerrellabrahams50@gmail.com';

async function sendOnboardingEmail({ email, password, fullName }) {
  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Your License Platform account is ready',
    html: `
      <p>Hi ${fullName || 'there'},</p>
      <p>An account has been created for you on License Platform. Here are your login credentials:</p>
      <p><strong>Email:</strong> ${email}<br/>
      <strong>Password:</strong> ${password}</p>
      <p>Use these to activate your subscription. Questions? Reply to this email or reach us at ${SUPPORT_EMAIL}.</p>
    `,
  });
  if (error) throw new Error(error.message);
}

module.exports = { sendOnboardingEmail };
