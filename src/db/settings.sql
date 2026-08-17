-- Business details printed on every invoice and receipt. Additive to schema.sql -- run
-- this against an already-provisioned project (paste into the SQL editor).
--
-- Supersedes the SELLER_*/BANK_* env vars: changing a phone number should not require a
-- redeploy. Nothing reads those env vars any more (SELLER_LOGO_PATH is the exception --
-- a logo is a file that ships with the build, not a setting).
--
-- One row, enforced by the primary key: `id boolean default true check (id)` admits
-- exactly one value, so a stray second insert collides instead of quietly creating a
-- rival set of business details that some PDFs would use and others wouldn't.

create table if not exists app_settings (
  id boolean primary key default true check (id),
  business_name text,           -- masthead; a trading name if there is one
  legal_name text,              -- e.g. "Jerrell Abrahams / Sole Proprietor"
  address text,                 -- free multi-line
  phone text,
  email text,
  -- Optional, and printing it does NOT start charging VAT. An unregistered sole
  -- proprietor may show an income tax reference number but may not add a VAT line to
  -- the document. Becoming a VAT vendor is a deliberate change to the PDF and to
  -- src/db/invoices.sql, never a side effect of filling this field in.
  tax_number text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  bank_branch_code text,
  bank_account_type text,
  updated_at timestamptz not null default now()
);

-- Seeded so the settings page only ever has to UPDATE. Without this the UI would need
-- an insert-or-update path to handle exactly one first save.
insert into app_settings (id) values (true) on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Mirrors the per-table policy in admin_access.sql. The settings page reads and writes
-- through the anon-key browser client, so this policy is load-bearing, not decorative.
--
-- Dropped first because Postgres has no `create policy if not exists` -- without this,
-- re-running the file dies here with "policy already exists".
drop policy if exists "admin full access" on app_settings;
create policy "admin full access" on app_settings for all
  using (is_admin()) with check (is_admin());
