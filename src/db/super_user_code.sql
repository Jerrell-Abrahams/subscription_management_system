-- Super user code: a per-subscription support code that signs into that customer's
-- POS without an employee account on the till. Additive to schema.sql -- run against
-- an already-provisioned project (paste into the SQL editor).

alter table subscriptions add column if not exists super_user_code text;

-- Held in plaintext here on purpose: this is the vendor's own secret, the column is
-- only reachable through the service_role key (the API) or an is_admin() policy, and
-- the admin UI has to be able to show you the code you're meant to type. It never
-- leaves this database in plaintext -- /activate and /status strip the column from
-- their response bodies, and the POS only ever receives a scrypt hash of it inside
-- the signed licence certificate (src/lib/superUserCode.js).
--
-- Typed on the POS's normal PIN keypad, so in practice this is 4-6 digits. That is a small
-- enough space to brute force offline from the hash on the customer's disk, which is fine
-- for what it unlocks -- manager rights on a till whose owner already has a manager PIN --
-- and is NOT fine if the same code is reused across customers, because then one customer's
-- afternoon of cracking opens every till you ship. Use a DIFFERENT random code per
-- subscription and look it up here before a support visit. To generate one:
--   node -e "console.log(String(require('crypto').randomInt(1e6)).padStart(6,'0'))"
--
-- The column is text, not an int, so it keeps leading zeros and stays free to hold a longer
-- code if the POS ever grows a non-keypad way to enter one.
