-- Manual cash ledger: one row per line on the business bank statement, typed by hand.
-- Additive to schema.sql -- run this against an already-provisioned project (paste into
-- the SQL editor) BEFORE deploying the code, or the Finance tab loads empty and every
-- save fails with "relation finance_entries does not exist".
--
-- This table is the ONLY record of cash, and it never reads, joins to, or sums invoices.
-- Invoices are what was BILLED; this is what actually moved through the bank. A customer
-- payment therefore appears twice in the system on purpose -- once as invoices.paid_at,
-- once as an 'in' row here. That duplication is the price of a ledger that reconciles
-- against a statement line for line, and it beats a total assembled from two sources
-- that can disagree.
--
-- No VAT and no tax fields: the owner is an unregistered sole proprietor, the same legal
-- constraint documented in src/db/invoices.sql. ZAR only.
--
-- Unrelated but adjacent: schema.sql still creates a `payments` table shaped for a Stripe
-- integration that never happened (currency defaults to 'usd', nothing in the repo reads
-- it). It is NOT dropped here -- a feature migration is the wrong place to delete a
-- table. To be rid of it, run `select count(*) from payments;`, confirm 0, then
-- `drop table payments;` on its own.

create table if not exists finance_entries (
  id uuid primary key default gen_random_uuid(),
  -- The date on the bank statement, not when it was typed. A plain `date`, so PostgREST
  -- returns 'YYYY-MM-DD' and every window comparison in the UI is a string comparison
  -- with no timezone left to get wrong.
  occurred_on date not null,
  direction text not null check (direction in ('in', 'out')),
  -- Always positive; direction carries the sign. A negative 'out' would silently ADD to
  -- the balance, which is the one arithmetic mistake this table must make impossible.
  amount numeric(10, 2) not null check (amount > 0),
  -- Free text on purpose. A CHECK list or a categories table would mean pasting SQL into
  -- Supabase before you could record a new kind of expense. The form offers the
  -- categories already in use as a datalist, which is enough to hold the spelling still.
  -- '' is rejected so a blank category can't become a second chart bucket beside null.
  category text check (category is null or category <> ''),
  description text,
  created_at timestamptz not null default now()
  -- Deliberately no updated_at: Postgres doesn't touch a default on UPDATE and this
  -- feature has no server code to set one, so the column would say "created" forever and
  -- lie about it. Add it together with whatever would maintain it.
);

-- Serves the page's only query: order by occurred_on desc.
create index if not exists finance_entries_occurred_on_idx on finance_entries (occurred_on);

alter table finance_entries enable row level security;

-- Mirrors the per-table policy in admin_access.sql. The Finance page reads AND writes
-- through the anon-key browser client, the same way the settings and products pages do,
-- so this policy is the entire authorisation story for the table. A missing policy
-- doesn't error -- the page just looks empty and every save fails, which is the
-- confusing version of the failure.
--
-- Dropped first because Postgres has no `create policy if not exists`; without this,
-- re-running the file dies here and never reaches the alters below.
drop policy if exists "admin full access" on finance_entries;
create policy "admin full access" on finance_entries for all
  using (is_admin()) with check (is_admin());

-- The running balance needs a starting point the ledger cannot know: what was already in
-- the account before the first row was typed. It lives on app_settings because it is one
-- value for the one business and that table is already exactly that shape -- the same
-- additive-alter trick invoices.sql uses for app_users.company_name.
--
-- Both nullable, and null means "not answered yet": the Finance page shows a prompt
-- rather than presenting R 0,00 as though it were your balance.
--
-- The date is read as the balance at the START of that day. Entries dated ON it count;
-- entries dated BEFORE it do not, because the opening balance already contains them.
alter table app_settings add column if not exists opening_balance numeric(10, 2);
alter table app_settings add column if not exists opening_balance_date date;
