-- Trackable QR codes. Additive to schema.sql -- run ONCE against the live project
-- (Supabase SQL editor) BEFORE deploying the code, or /api/admin/qr and the public
-- /:code redirect both 500 on a missing table.
--
-- The printed QR never contains the destination. It contains https://qr.complexai.co.za/<code>,
-- and this table is what turns that into a real URL at scan time. That indirection is the
-- whole point: paper outlives decisions, so the destination has to stay editable after the
-- cards are printed, and the scan can be counted on the way past.

create table qr_codes (
  id          uuid primary key default gen_random_uuid(),
  -- The <code> in the printed URL. Short on purpose: fewer characters is a less dense QR,
  -- which matters because the logo erases the middle of it (see src/lib/qr.js).
  code        text not null unique,
  label       text not null,
  -- Optional. A QR for a website sale hangs off the website row; a QR for a Google review
  -- link or a flyer has no parent and is not made to invent one. Same call website_kinds.sql
  -- made for demo sites. on delete set null: removing a website must not silently kill a
  -- code that is already printed on someone's business cards.
  website_id  uuid references websites(id) on delete set null,
  destination text not null,
  -- Retire rather than delete. A deleted row is a dead QR on printed material with no
  -- record of what it was; an inactive one serves an explanation and keeps its history.
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One row per code per day, not per scan. Storing a row per hit would carry no more
-- information than a count once the timestamp is truncated to a day, and would grow
-- without limit under link-preview bots. This caps at 365 rows per code per year and
-- still draws the trend line.
create table qr_scans (
  qr_code_id uuid not null references qr_codes(id) on delete cascade,
  day        date not null,
  hits       integer not null default 0,
  primary key (qr_code_id, day)
);

-- Atomic increment. Done as a function so the redirect is one round trip and concurrent
-- scans cannot lose counts to a read-modify-write race.
create or replace function public.record_qr_scan(p_code_id uuid)
  returns void language sql security definer set search_path = public
as $$
  insert into qr_scans (qr_code_id, day, hits)
  values (p_code_id, (now() at time zone 'utc')::date, 1)
  on conflict (qr_code_id, day) do update set hits = qr_scans.hits + 1;
$$;

alter table qr_codes enable row level security;
alter table qr_scans enable row level security;

-- Mirrors the per-table policy in admin_access.sql. The public redirect reads and writes
-- through the service_role key (bypasses RLS) exactly like src/routes/site.js does.
create policy "admin full access" on qr_codes for all using (is_admin()) with check (is_admin());
create policy "admin full access" on qr_scans for all using (is_admin()) with check (is_admin());
