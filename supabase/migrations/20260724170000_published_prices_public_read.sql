-- The storefront (B-102, exact-printing page) needs to show the current
-- price for a SKU to unauthenticated customers, but published_prices only
-- had a staff-scoped policy (20260723082400_published_prices_and_overrides.sql)
-- restricted to org members. Per AGENTS.md hard rule 4 ("fix the policy...
-- instead"), add a second, narrower policy rather than loosening the
-- existing one: anyone may read an *active* published price (equivalent to
-- what's already shown on a printed price tag in-store), but archived/
-- suspended price history stays staff-only, matching the existing policy's
-- scope for those statuses.
create policy published_prices_select_public on published_prices
  for select to anon, authenticated
  using (status = 'active');
