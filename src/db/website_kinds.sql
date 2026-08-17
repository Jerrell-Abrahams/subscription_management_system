-- Websites get a `kind`, and demo sites get to exist without billing.
--
-- Run ONCE against the live project (Supabase SQL editor) BEFORE deploying the code, or
-- the Websites tab queries a `kind` column that isn't there and renders empty.
--
-- Why subscription_id becomes nullable: a demo is a template showcase in our own Vercel
-- account. It has no customer, no billing interval and no period end. The alternative --
-- inventing ~20 fake customers and ~20 fake subscriptions purely to satisfy a foreign
-- key -- would pollute Customers, Subscriptions, the dashboard KPIs and the daily expiry
-- cron, all to store a URL.
--
-- The CHECK below keeps the old guarantee where it actually mattered: a *client* website
-- still cannot exist without a subscription, so the billing path is exactly as strict as
-- it was. Only non-client kinds are allowed to float free.

alter table websites alter column subscription_id drop not null;

alter table websites add column if not exists kind text not null default 'client'
  check (kind in ('client', 'demo', 'internal'));

-- Existing rows default to 'client'. complexai.co.za is our own property, not a customer's,
-- so it is reclassified here. Its subscription row is deliberately left alone -- retiring
-- that is a billing decision, not a schema one. Being 'internal' already exempts it from
-- the kill switch in src/routes/site.js.
update websites set kind = 'internal' where lower(domain) = 'complexai.co.za';

alter table websites drop constraint if exists websites_client_needs_subscription;
alter table websites add constraint websites_client_needs_subscription
  check (kind <> 'client' or subscription_id is not null);

-- Demo templates, one row per Vercel project. Domains are stored as bare lowercase
-- hostnames to match normalizeDomain() in src/lib/websiteAccess.js -- the value looked up
-- per request and the value stored here have to be the same shape.
--
-- `on conflict do nothing` (no target, so it catches the lower(domain) expression index)
-- makes this file safe to re-run.
insert into websites (domain, kind) values
  ('dentist-alpha-five.vercel.app', 'demo'),
  ('doctor-opal-mu.vercel.app', 'demo'),
  ('barber-sigma-olive.vercel.app', 'demo'),
  ('spa-omega-blue.vercel.app', 'demo'),
  ('gym-nu-seven-52.vercel.app', 'demo'),
  ('coffee-puce-kappa.vercel.app', 'demo'),
  ('restaurant-nine-gamma-63.vercel.app', 'demo'),
  ('attorney-nu.vercel.app', 'demo'),
  ('church-ten-khaki.vercel.app', 'demo'),
  ('mechanic-flame.vercel.app', 'demo'),
  ('turbo-phi-sable.vercel.app', 'demo'),
  ('security-azure.vercel.app', 'demo'),
  ('cleaning-rosy-one.vercel.app', 'demo'),
  ('plumber-gold.vercel.app', 'demo'),
  ('funeral-theta.vercel.app', 'demo'),
  ('construction-one-plum.vercel.app', 'demo'),
  ('estate-eta-sand.vercel.app', 'demo'),
  ('guesthouse-xi-rose.vercel.app', 'demo'),
  ('holiday-lake-chi.vercel.app', 'demo'),
  ('school-management-system-six-rouge.vercel.app', 'demo')
on conflict do nothing;
