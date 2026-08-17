-- Per-subscription add-on modules: optional parts of a product that a customer pays extra for
-- and that stay invisible to everyone else. First use is the POS's Wholesaler module. Additive to
-- schema.sql -- run against an already-provisioned project (paste into the SQL editor).

alter table subscriptions add column if not exists modules text[] not null default '{}';

-- Why a column here rather than a setting inside the customer's own app database: the app database
-- is a local SQLite file on the customer's machine, so a flag in it is a flag the customer can
-- flip. This column travels to the device inside the RS256-signed licence certificate
-- (src/lib/modules.js), which the app can verify but not forge.
--
-- Slugs are matched case-sensitively against a fixed list compiled into the consuming app, which
-- ignores any name it doesn't recognise. That means a typo here fails closed -- the customer
-- simply doesn't get the module -- rather than half-enabling anything. It also means an older
-- installed version safely ignores a module added after it shipped.
--
-- NOT stripped from /activate and /status response bodies, unlike super_user_code: which modules
-- you bought is the customer's own information, and the app needs it to decide what to show.
--
-- text[] rather than jsonb because these are a flat set of slugs with no structure, and Postgres
-- array containment (`modules @> array['wholesale']`) makes "which tenants have the module?"
-- a one-line query when it's time to bill for it.
