-- Client contact number for the invoice Bill To block. Additive -- run this against an
-- already-provisioned project (paste into the SQL editor).
--
-- Its own file rather than an addition to invoices.sql because that file's `create
-- policy` statements are not re-runnable: pasting it a second time errors on the policy
-- that already exists, and stops before reaching anything appended below it.
--
-- The other Bill To fields already exist: email and full_name from schema.sql,
-- company_name and billing_address from invoices.sql.

alter table app_users add column if not exists phone text;
