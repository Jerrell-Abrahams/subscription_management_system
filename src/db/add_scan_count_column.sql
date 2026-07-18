-- Promote the scan count out of analytics_events.payload->>'successfulScans'
-- into a first-class integer column.
--
-- ORDER MATTERS: run this ONCE against the live Supabase project
-- (Dashboard -> SQL Editor) BEFORE deploying the analytics.js change. If the
-- new route code writes scan_count before this column exists, every insert
-- 500s.

alter table analytics_events add column if not exists scan_count integer;

-- Backfill existing rows from the jsonb payload (safe to re-run).
update analytics_events
set scan_count = (payload->>'successfulScans')::int
where scan_count is null
  and payload ? 'successfulScans'
  and (payload->>'successfulScans') ~ '^[0-9]+$';
