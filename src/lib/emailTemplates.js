// Email bodies as pure functions: data in, { subject, html } out, nothing sent. Resend is
// never imported here, which is what lets `node --test` assert the wording and the rand
// amounts without mocking a mail provider -- same arrangement as invoices.js next door.
//
// Everything here goes to ONE recipient: you. There is deliberately no client-facing
// template in this file yet. When that changes, the sending domain has to be verified at
// Resend first (see the FROM comment in email.js) -- an unverified domain delivers only to
// the account owner, which is exactly why this file is safe to ship today.

const { formatMoney, formatDate } = require('./invoices');

const CONSOLE = 'https://admin.complexai.co.za';

// Inline styles only. Gmail and Outlook strip <style> blocks, so a stylesheet would look
// right in the preview and arrive as unstyled text.
const WRAP = 'margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a';
const CARD = 'max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e4;border-radius:8px;padding:24px';
const H2 = 'margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#6e6e6e';
const ROW = 'padding:6px 0;border-top:1px solid #eeeeee;font-size:14px;line-height:1.45';

const days = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000);

// Every value below is somebody else's text: business names come from Google Places via
// the leads importer, domains and error strings come from Postgres. "Fish & Chips <Sea
// Point>" would otherwise arrive as "Fish " with its identifying half eaten by the mail
// client. Only interpolated data goes through this -- formatMoney/formatDate output is ours.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);

// A section with no rows is dropped rather than rendered as "None". A list of five
// headings, four of them empty, is a report you stop reading.
const section = (title, href, rows) =>
  rows.length === 0
    ? ''
    : `<h2 style="${H2}"><a href="${CONSOLE}${href}" style="color:#6e6e6e;text-decoration:none">${title} (${rows.length}) →</a></h2>` +
      rows.map((r) => `<div style="${ROW}">${r}</div>`).join('');

/**
 * The daily digest. Returns null when there is nothing to report AND nothing broke --
 * silence is the signal that the day is clear. Errors always send, because a silent
 * failure would otherwise be indistinguishable from a quiet day, which is the trap the
 * old onboarding email fell into.
 *
 * `today` is a parameter, not a call to new Date(), so the day-counting is testable.
 */
function digest({ overdue = [], expiring = [], wentDark = [], followUps = [], errors = [], today }) {
  const now = today || new Date().toLocaleDateString('sv'); // local calendar date, not UTC

  const body =
    section(
      'Overdue invoices',
      '/invoices',
      overdue.map((i) => {
        const late = days(i.dueDate, now);
        return `<strong>${esc(i.number)}</strong> · ${formatMoney(i.amount)} · ${esc(i.customer)} — <span style="color:#c62828">${late} day${late === 1 ? '' : 's'} overdue</span>`;
      })
    ) +
    section(
      'Expiring within 7 days',
      '/subscriptions',
      expiring.map(
        (s) =>
          `${esc(s.customer)} · ${esc(s.product)} — ends ${formatDate(s.endsAt)}` +
          (s.domain ? ` <span style="color:#6e6e6e">(${esc(s.domain)} goes offline)</span>` : '')
      )
    ) +
    section(
      'Went dark overnight',
      '/subscriptions',
      wentDark.map(
        (s) =>
          `${esc(s.customer)} · ${esc(s.product)}` +
          (s.domain ? ` — <strong>${esc(s.domain)}</strong> is now offline` : '')
      )
    ) +
    section(
      'Follow-ups due',
      '/leads',
      followUps.map((l) => `${esc(l.name)} — due ${formatDate(l.followUpDate)}`)
    ) +
    section(
      'Errors during this run',
      '/',
      errors.map((e) => `<span style="color:#c62828">${esc(e)}</span>`)
    );

  if (!body) return null;

  // Counts in the subject so the notification alone tells you whether to open it.
  const counts = [
    overdue.length && `${overdue.length} overdue`,
    expiring.length && `${expiring.length} expiring`,
    wentDark.length && `${wentDark.length} offline`,
    followUps.length && `${followUps.length} follow-up${followUps.length === 1 ? '' : 's'}`,
    errors.length && `${errors.length} error${errors.length === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return {
    subject: `${counts.join(' · ')} — Complex AI`,
    html: `<div style="${WRAP}"><div style="${CARD}">
      <div style="font-size:16px;font-weight:600">Complex AI — ${formatDate(now)}</div>
      ${body}
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #eeeeee;font-size:12px;color:#8a8a8a">
        Sent by the daily job. Nothing in this email went to a customer.
      </div>
    </div></div>`,
  };
}

module.exports = { digest, CONSOLE };
