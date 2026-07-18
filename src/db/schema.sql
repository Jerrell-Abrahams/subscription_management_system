-- License / subscription management schema
-- Run this against your Supabase project's Postgres database.

create extension if not exists "pgcrypto";

-- Extends auth.users with app-facing profile data
create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supports multiple apps/products under one platform
create table products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- A user's access to a product. No license keys -- access is governed
-- entirely by having a subscription row with an active status; a device
-- "activates" by authenticating as the owning user (see activations below).
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled', 'expired', 'revoked')),
  max_activations int not null default 1,
  current_activations int not null default 0,
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Device fingerprint bound to a subscription, up to subscription.max_activations
create table activations (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  device_fingerprint text not null,
  device_name text,
  activated_at timestamptz not null default now(),
  unique (subscription_id, device_fingerprint)
);

-- Schema only -- no payment provider integrated yet
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  amount numeric(10, 2),
  currency text default 'usd',
  provider text,
  provider_payment_id text,
  status text default 'pending',
  created_at timestamptz not null default now()
);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  event_type text not null,
  -- promoted out of payload for easy aggregation/sorting; null for events
  -- that don't report a scan count
  scan_count integer,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Release metadata per product, served by /api/updates/latest
create table updates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  version text not null,
  download_url text not null,
  release_notes text,
  published_at timestamptz not null default now()
);

-- Row Level Security: users can only see their own rows through the
-- Supabase client directly. The Express API uses the service_role key,
-- which bypasses RLS and does its own authz via req.user.userId.

alter table app_users enable row level security;
create policy "own profile" on app_users
  for select using (auth.uid() = id);

alter table subscriptions enable row level security;
create policy "own subscriptions" on subscriptions
  for select using (auth.uid() = user_id);

alter table payments enable row level security;
create policy "own payments" on payments
  for select using (auth.uid() = user_id);

alter table analytics_events enable row level security;
create policy "own analytics events" on analytics_events
  for select using (auth.uid() = user_id);
