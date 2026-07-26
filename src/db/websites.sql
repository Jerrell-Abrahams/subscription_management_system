-- Websites product: sell a hosted website, block it when the customer stops paying.
-- Additive to schema.sql -- run ONCE against the live project (SQL editor) BEFORE
-- deploying the code, or the admin create + /api/site/status route 500 on a missing table.
--
-- A website's billing/block state is NOT reinvented here: it rides on a normal
-- subscriptions row (status + current_period_end), so it inherits admin renew/revoke
-- and the daily expiry cron. This table just pins a domain to that subscription. A
-- site "serves" only while its subscription is active and inside its period (see
-- src/lib/websiteAccess.js) -- suspending = flipping the subscription to past_due.

create table websites (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  domain text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness. The API lowercases before insert; this index is the
-- backstop and is what a duplicate-domain insert trips (mapped to 409 in admin.js).
create unique index websites_domain_lower_idx on websites (lower(domain));

alter table websites enable row level security;
-- Mirrors the per-table policy in admin_access.sql. The public status route reads
-- through the service_role key (bypasses RLS); only admins read via the supabase client.
create policy "admin full access" on websites for all using (is_admin()) with check (is_admin());

-- One product row all website subscriptions hang off. enforce_activation_limit = false:
-- a website never runs the device-activation path, so no max_activations gate applies.
insert into products (slug, name, enforce_activation_limit)
values ('website', 'Website', false)
on conflict (slug) do nothing;
