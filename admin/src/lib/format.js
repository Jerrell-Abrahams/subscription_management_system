// Browser-side ZAR and date formatting, shared by the Finance ledger and the invoices
// card. Not imported from src/lib/invoices.js: that is CommonJS on the server, this is an
// ESM bundle, and a package to join them costs more than these three lines (the same
// trade-off InvoicesCard.jsx used to state inline). A third copy was the tipping point --
// two screens showing the same rand in two different shapes is a bug you find in a
// screenshot, months later.
export const money = (a) =>
  a == null ? '—' : `R ${Number(a).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const day = (d) =>
  d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// Parses a bare 'YYYY-MM-DD' (or 'YYYY-MM') as a LOCAL date, not UTC -- new Date('2026-08-24')
// alone parses as UTC midnight, which renders as the 23rd anywhere west of Greenwich. This
// was hand-rolled three times (Websites.jsx, Finance.jsx, Leads.jsx) with the same trick and
// three different explanations; centralised so a future fix only has one place to land.
export const parseLocalDate = (dateStr) => new Date(`${dateStr}T00:00:00`);

// 'sv' is the ISO-shaped locale, so this is the LOCAL calendar date. toISOString() would
// be UTC and hand back yesterday until 02:00 SAST -- which is what this used to do inside
// InvoicesCard, quietly marking a not-yet-overdue invoice overdue every early morning and
// defaulting "date paid" to the wrong day. Same trick as Leads.jsx.
export const today = () => new Date().toLocaleDateString('sv');
