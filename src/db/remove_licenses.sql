-- One-time migration for the already-live project: drop the license-key
-- concept, subscriptions becomes the access anchor. Run once via
-- `npx supabase db query --linked -f src/db/remove_licenses.sql`.

alter table subscriptions add column if not exists product_id uuid references products(id) on delete cascade;
alter table subscriptions add column if not exists max_activations int not null default 1;
alter table subscriptions add column if not exists current_activations int not null default 0;
alter table subscriptions alter column product_id set not null;
alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('pending','active','past_due','canceled','expired','revoked'));
alter table subscriptions drop column if exists license_id;

alter table activations add column if not exists subscription_id uuid references subscriptions(id) on delete cascade;
delete from activations where subscription_id is null;
alter table activations alter column subscription_id set not null;
alter table activations drop column if exists license_id;

drop table if exists licenses cascade;
