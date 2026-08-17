-- Invoices + receipts. Additive to schema.sql -- run this against an already-provisioned
-- project (paste into the SQL editor) BEFORE deploying the code, or the Invoices card on
-- the subscription page and every /api/admin/invoices route 500 on a missing table.
--
-- ZAR only and no VAT anywhere: the seller is an unregistered sole proprietor, so the
-- document is headed "Invoice" (never "Tax Invoice"), carries no VAT number and no tax
-- line. That is a legal constraint, not a layout choice. Registering for VAT later means
-- adding tax columns here and two lines to the PDF, not reshaping this table.
--
-- There is deliberately no price column on products or subscriptions. Every deal is
-- negotiated per customer, so the amount is typed per invoice and the previous invoice
-- for a subscription is what the next draft copies from -- the last invoice IS the
-- price memory.

-- Starts at 10 so the first invoice you send doesn't announce itself as your first.
create sequence if not exists invoice_number_seq start 10;

-- Called on send rather than set as a column default: a draft you abandon must not burn
-- a number. nextval is atomic, so the nightly cron and a manual click landing together
-- still get distinct numbers -- a `select max(number) + 1` would hand out the same one twice.
create or replace function public.next_invoice_number() returns int
  language sql security definer set search_path = public
as $$
  select nextval('invoice_number_seq')::int;
$$;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  -- null while draft. Rendered as INV-0010 on the invoice and RCT-0010 on the receipt:
  -- one identity, two documents, so the pair can never disagree about who paid what.
  number int unique,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  amount numeric(10, 2),        -- null on a first draft with no prior invoice to copy
  description text,             -- line item override; null falls back to a generated one
  period_start timestamptz not null,
  period_end timestamptz not null,
  due_date date not null,
  sent_at timestamptz,
  paid_at timestamptz,
  payment_reference text,       -- the customer's bank reference, captured when marking paid
  void_reason text,
  pdf_path text,                -- storage object path, written on send
  receipt_pdf_path text,        -- ditto, written on mark-paid
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The nightly cron and the "New invoice" button can both fire for the same period. This
-- is what makes a duplicate impossible rather than merely unlikely. Voids are excluded
-- so that voiding a wrong invoice frees the period up to be reissued.
create unique index if not exists invoices_subscription_period_idx
  on invoices (subscription_id, period_start)
  where status <> 'void';

alter table invoices enable row level security;

-- Mirrors the per-table policy in admin_access.sql. Customers never read this table --
-- they receive the PDF by hand -- so there is no "own invoices" policy on purpose.
--
-- Dropped first because Postgres has no `create policy if not exists`, and every other
-- statement in this file is already guarded. Without this, re-running the file dies here
-- with "policy already exists" and never reaches what follows.
drop policy if exists "admin full access" on invoices;
create policy "admin full access" on invoices for all
  using (is_admin()) with check (is_admin());

-- Private bucket: invoices carry names, addresses and amounts. Uploads and downloads
-- both go through the API on the service_role key (which bypasses storage RLS), so the
-- browser never touches this bucket directly and it needs no storage policies.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Bill To needs more than an email address once a customer's bookkeeper files the PDF.
-- Both nullable: they simply don't render when blank.
alter table app_users add column if not exists company_name text;
alter table app_users add column if not exists billing_address text;
