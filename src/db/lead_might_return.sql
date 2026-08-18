-- Adds the "might get back to me" outcome and the status it leaves a lead in.
--
-- Purely additive: both statements widen a check constraint, so nothing existing becomes
-- invalid and no data moves. Safe to run before the matching code deploys -- the new
-- values simply have nothing writing them until the UI ships.
--
-- Why this is not just `follow_up`. That outcome requires a follow_up_date (src/routes/
-- leads.js rejects it without one) and feeds the follow-ups-due list, because follow_up
-- means you committed to contacting them on a date. "Might get back to me" is the
-- opposite: the prospect took the next step and you have no date to work to. Folding it
-- into follow_up would mean inventing a date and polluting the due list with rows you
-- cannot action.
--
-- Why it is not just `contacted` either. The leads table filters by status, not by
-- outcome, so an outcome with no status of its own is unfindable -- you would have to
-- open each lead to see it, which defeats the point of recording it.

alter table lead_activities drop constraint if exists lead_activities_outcome_check;
alter table lead_activities add constraint lead_activities_outcome_check
  check (outcome in ('no_answer', 'not_interested', 'follow_up', 'might_return', 'potential', 'converted'));

alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check
  check (status in ('new', 'contacted', 'follow_up', 'might_return', 'potential', 'not_interested', 'converted'));
