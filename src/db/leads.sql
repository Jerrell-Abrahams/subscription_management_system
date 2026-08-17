-- Leads / outreach tracking (cold calls, walk-ins, cold messages, reach-outs) plus the
-- Google Places lead finder. Additive to schema.sql -- run this against an already-
-- provisioned project (paste into the SQL editor) BEFORE deploying the code, or the
-- admin Leads page and /api/leads routes 500 on missing tables.
--
-- Reads (leads list, lead_activities) go straight from the admin browser through the
-- anon-key supabase client, same as every other admin page -- so RLS here is
-- load-bearing. A missing policy doesn't error, it just makes the page look empty.
--
-- Goals and campaign categories are NOT defined here: they were replaced wholesale by
-- src/db/leads_goals_v2.sql, which owns lead_goals and lead_categories. Keeping the old
-- definition here made this file fail on re-run once v2 had been applied.

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,          -- dedupe key for Places imports; null for hand-added leads
  name text not null,
  phone text,
  email text,                           -- Places (New) never returns this; manual field
  website text,                         -- null = no website, which is the sales hook
  address text,
  industry text,                        -- search term that found it, e.g. "plumber"
  category text,                        -- campaign category pitched, e.g. "websites"
  rating numeric,
  review_count int,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'follow_up', 'potential', 'not_interested', 'converted')),
  follow_up_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per outreach attempt, independent of method -- a lead may be called, then
-- walked in on, then messaged. Stats (calls/week, per-category goals) are computed by
-- counting these rows, not by looking at the lead's current status.
create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  method text not null default 'cold_call'
    check (method in ('cold_call', 'walk_in', 'cold_message', 'reach_out')),
  outcome text not null
    check (outcome in ('no_answer', 'not_interested', 'follow_up', 'potential', 'converted')),
  category text not null,
  note text,
  occurred_at timestamptz not null default now()
);
create index if not exists lead_activities_occurred_at_idx on lead_activities (occurred_at);
create index if not exists lead_activities_lead_id_idx on lead_activities (lead_id);

-- One row per billable Google Places search. Exists purely to count usage against the
-- free tier (1,000 Text Search Enterprise calls per calendar month) -- POST /api/leads/search
-- refuses once the month's count hits the cap, so overspending isn't possible by accident.
-- Doubles as a record of what's already been searched, so the same paid query isn't re-run.
create table if not exists lead_searches (
  id uuid primary key default gen_random_uuid(),
  location text not null,
  industry text not null,
  result_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lead_searches_created_at_idx on lead_searches (created_at);

alter table leads enable row level security;
alter table lead_activities enable row level security;
alter table lead_searches enable row level security;

-- create policy has no IF NOT EXISTS; drop-then-create keeps this file re-runnable.
drop policy if exists "admin full access" on leads;
create policy "admin full access" on leads for all using (is_admin()) with check (is_admin());

drop policy if exists "admin full access" on lead_activities;
create policy "admin full access" on lead_activities for all using (is_admin()) with check (is_admin());

drop policy if exists "admin full access" on lead_searches;
create policy "admin full access" on lead_searches for all using (is_admin()) with check (is_admin());
