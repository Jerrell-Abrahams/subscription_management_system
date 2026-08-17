-- Payfast import for the Finance ledger. Additive to finance.sql -- paste this into the
-- Supabase SQL editor BEFORE deploying the code. Until it runs, every sync fails on a
-- missing column; the rest of the Finance tab carries on working exactly as it does today,
-- which is the point of keeping the import additive rather than reshaping the table.
--
-- WHAT THIS ACCOUNT ACTUALLY CONTAINS, checked against the live API on 2026-08-17:
-- two transactions in two years, and neither is a customer paying. It is being used as a
-- BUYER wallet -- a R49 topup from a credit card, immediately spent at Host Africa. No
-- money has ever come IN from a customer. Read the mapping in src/lib/payfast.js with that
-- in mind rather than assuming a merchant receiving account.
--
-- Consequently a topup is dropped, not imported: it is a transfer between the owner's own
-- accounts, and booking it as income would have one R49 hosting bill read as R49 earned
-- AND R49 spent on the same day. Only the purchase is a real economic event.
--
-- Where a payment IS received, it becomes TWO rows: the gross as 'in', and Payfast's cut as
-- a matching 'out' categorised "Payfast fees", so the fee is visible on the spend chart
-- instead of quietly shrinking every payment. Known cost: "Balance today" would then run
-- AHEAD of the real bank balance by whatever Payfast has taken but not yet settled. The
-- honest fix is modelling Payfast as a second account with its own balance -- a much larger
-- change to the balance card and the opening-balance model, and unjustified until money
-- actually starts arriving here.

-- null = typed by hand, 'payfast' = pulled from the API. Manual entry is untouched: the
-- Finance form never sets either column, so every existing row and every future hand-typed
-- one stays null here and behaves exactly as before.
alter table finance_entries add column if not exists source text;
alter table finance_entries add column if not exists external_id text;

-- The whole reason a sync is safe to re-run, and why overlapping windows cost nothing: a
-- second import of the same transaction collides here and is dropped rather than doubling
-- your income.
--
-- external_id is NOT the Payfast payment id on its own -- Payfast reuses one id across both
-- legs of a transaction (the live topup and the purchase it funded both carry 320759399),
-- so an id-only key would let this index silently swallow one of the two. It is
-- id:type:sign, plus a ':fee' suffix for the fee row. See toEntries in src/lib/payfast.js.
--
-- Deliberately NOT a partial index (`where source is not null`), even though only synced
-- rows need constraining: PostgREST's on_conflict cannot infer a partial index, so upsert
-- would fail with "no unique or exclusion constraint matching". A plain index is safe here
-- anyway -- Postgres treats NULLs as distinct, so any number of hand-typed rows can share
-- (null, null) without colliding.
create unique index if not exists finance_entries_source_external_idx
  on finance_entries (source, external_id);
