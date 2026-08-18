// The one rule that decides whether an unpaid invoice is visible. It lives here rather
// than inline in InvoicesCard so `node --test` can reach it without a bundler -- the same
// arrangement as finance.js, and worth the file because the failure mode is silent: a
// wrong branch here hides money you are owed instead of throwing.

// Money still owed: drafted but not issued, or issued but not paid.
export const OUTSTANDING = ['draft', 'sent'];

export const matchesFilter = (invoice, filter) =>
  filter === 'all' ? true : filter === 'outstanding' ? OUTSTANDING.includes(invoice.status) : invoice.status === filter;

// Sent, and the due date is behind us. Same rule the sidebar badge asks Postgres for
// (Layout.jsx) and the row highlight uses -- stated once so they cannot drift apart.
export const isOverdue = (invoice, today) => invoice.status === 'sent' && invoice.due_date < today;
