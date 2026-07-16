-- Real per-subscription device-count enforcement. Additive to schema.sql --
-- run this against an already-provisioned project (paste into the SQL editor).
--
-- /activate never checked current_activations against max_activations before
-- (see routes/subscription.js) -- deliberately, for the existing 'desktop-app'
-- product, which reactivates from a new device fingerprint on every run by
-- design. This flag lets other products (e.g. the POS) opt into a real cap
-- without changing that product's behavior.

alter table products add column if not exists enforce_activation_limit boolean not null default true;

update products set enforce_activation_limit = false where slug = 'desktop-app';
