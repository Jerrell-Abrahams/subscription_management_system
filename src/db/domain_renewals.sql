-- Websites get a domain renewal date, so a domain stops renewing silently in either
-- direction: an ex-client's on your card, or your own lapsing unnoticed.
--
-- Run ONCE against the live project (Supabase SQL editor) BEFORE deploying the code, or
-- the Websites tab and the daily digest both query a column that isn't there.
--
-- Nullable, and null is a real answer: it means "not tracked", which is correct for a
-- domain the client registered themselves and renews directly. Only a date opts a row
-- into the digest, so every existing row stays silent until you fill one in -- otherwise
-- the first digest after this migration is a list of every website you have ever built.
--
-- ponytail: no index. The digest scans the whole table once a day and there are tens of
-- rows; add one if websites ever reaches the thousands, which it will not.

alter table websites add column if not exists domain_renews_on date;

comment on column websites.domain_renews_on is
  'When the domain registration next expires. Null = we do not track this one (client renews it themselves).';
