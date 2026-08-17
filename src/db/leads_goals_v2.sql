-- Goals v2: replaces the per-category weekly counter with user-defined goals that carry
-- a name, a target, a due date, and a choice of how progress is measured.
--
-- Additive to leads.sql EXCEPT for one destructive step: the old lead_goals table is
-- dropped. That is safe as written because the v1 table only ever held a category and a
-- weekly number -- but if you have set real weekly targets since, note them down first,
-- they are not migrated. Run this immediately BEFORE deploying the matching code: in
-- between, the category dropdowns read a table that does not exist yet.

drop table if exists lead_goals;

create table if not exists lead_goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target numeric not null check (target > 0),

  -- How `current` is derived. 'manual' is the escape hatch for anything the database
  -- cannot see (revenue, meetings booked); the rest are counted server-side so they
  -- never drift from the underlying activity log.
  source text not null default 'manual'
    check (source in ('manual', 'contacts', 'conversions', 'leads_added')),

  category text,                        -- optional filter for the counted sources
  manual_current numeric not null default 0,

  -- Counting window. Progress stops accruing after due_date, so a goal that expires
  -- keeps the number it finished on instead of creeping up forever.
  start_date date not null default current_date,
  due_date date,

  archived_at timestamptz,              -- hidden from the default view, never deleted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_goals_archived_idx on lead_goals (archived_at);

-- v1 used lead_goals.category as the category list, which is what populated every
-- category dropdown in the admin UI. Goals are now free-form, so the list needs its own
-- home -- without this the finder, Log Contact, Edit Lead and the filter all go empty.
create table if not exists lead_categories (
  name text primary key
);

insert into lead_categories (name) values
  ('websites'),
  ('pos-software'),
  ('custom-software')
on conflict (name) do nothing;

alter table lead_goals enable row level security;
alter table lead_categories enable row level security;

drop policy if exists "admin full access" on lead_goals;
create policy "admin full access" on lead_goals for all using (is_admin()) with check (is_admin());

drop policy if exists "admin full access" on lead_categories;
create policy "admin full access" on lead_categories for all using (is_admin()) with check (is_admin());
