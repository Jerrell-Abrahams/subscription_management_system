-- Money goals: lets a goal count rands received rather than rows logged.
--
-- Fully additive -- no drops, no data migration. Existing goals keep their source and
-- pick up unit='count', which is exactly what they were already doing implicitly.
-- Safe to run before deploying the matching code: the new source values simply have
-- nothing selecting them until the UI ships.
--
-- Background: leads_goals_v2.sql called 'manual' "the escape hatch for anything the
-- database cannot see (revenue, meetings booked)". That was true when it was written --
-- finance.sql and invoices.sql did not exist yet. Revenue is now visible, so it stops
-- being a number you tick up 15,000 times by hand.

-- Two sources rather than one, because this app has two unreconciled notions of income:
--   revenue_received -> finance_entries where direction = 'in'. Everything that landed,
--                       including once-off work that never had a subscription behind it.
--                       Lags your bookkeeping, since that ledger is hand-entered.
--   invoices_paid    -> invoices where status = 'paid', summed over paid_at. Instant on
--                       Mark paid, but blind to income that never got invoiced.
-- Marking an invoice paid does NOT write a finance entry (Finance.jsx is the only writer
-- to finance_entries), so the same rand can exist in both. A goal picks one; summing
-- both together would double count.
alter table lead_goals drop constraint if exists lead_goals_source_check;
alter table lead_goals add constraint lead_goals_source_check
  check (source in ('manual', 'contacts', 'conversions', 'leads_added', 'revenue_received', 'invoices_paid'));

-- Deliberately separate from `source` rather than derived from it. A manual goal can be
-- money too -- a cash deal closed before it ever became an invoice or a ledger line is
-- the normal case here -- and deriving money-ness from the source would leave that one
-- rendering as a bare number with no R.
alter table lead_goals add column if not exists unit text not null default 'count'
  check (unit in ('count', 'currency'));
