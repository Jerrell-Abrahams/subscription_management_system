-- Admin dashboard access. Additive to schema.sql -- run this against an
-- already-provisioned project (paste into the SQL editor).

alter table app_users add column if not exists is_admin boolean not null default false;

-- These three tables had no RLS at all. Harmless while only the
-- service_role-key backend touched them, but now that an anon-key browser
-- client exists, Supabase's default grants would otherwise make them
-- world-readable/writable to anyone holding the anon key.
alter table products enable row level security;
alter table activations enable row level security;
alter table updates enable row level security;

-- products/updates are already served without auth via /api/updates/latest,
-- so public read access here doesn't change what's exposed.
create policy "public read products" on products for select using (true);
create policy "public read updates" on updates for select using (true);

-- SECURITY DEFINER function to check the caller's admin flag. Policies must
-- call this instead of subquerying app_users inline -- a policy ON app_users
-- that subqueries app_users to check is_admin re-triggers its own policy
-- evaluation and recurses infinitely. Running the check inside a definer
-- function (owned by a role that bypasses RLS) breaks that cycle.
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public
as $$
  select coalesce((select is_admin from app_users where id = auth.uid()), false);
$$;

-- Admin full access, gated on is_admin(), one policy per table.
create policy "admin full access" on app_users for all
  using (is_admin()) with check (is_admin());

create policy "admin full access" on products for all
  using (is_admin()) with check (is_admin());

create policy "admin full access" on activations for all
  using (is_admin()) with check (is_admin());

create policy "admin full access" on subscriptions for all
  using (is_admin()) with check (is_admin());

create policy "admin full access" on payments for all
  using (is_admin()) with check (is_admin());

create policy "admin full access" on analytics_events for all
  using (is_admin()) with check (is_admin());

create policy "admin full access" on updates for all
  using (is_admin()) with check (is_admin());
