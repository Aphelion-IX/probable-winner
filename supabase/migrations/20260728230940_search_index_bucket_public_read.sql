-- apps/web now loads the search index snapshot directly from Storage on
-- Vercel (serverless functions cache it in memory across warm invocations,
-- refreshing periodically -- see apps/web/src/lib/search-index-cache.ts)
-- rather than calling a separately-hosted worker HTTP endpoint. That means
-- apps/web's own anon-key client needs read access to this bucket, not just
-- the worker's service-role key (which bypasses RLS and was, until now, the
-- only thing that could read it -- migration 20260728020000 created the
-- bucket with no policy at all, deliberately relying on default-deny).
--
-- SELECT only, scoped to this one bucket. The snapshot's contents (card
-- names, prices, stock levels per store) are not sensitive -- they're the
-- same data already served to anonymous shoppers throughout the storefront
-- (card_browse, published_prices, inventory_balances are all anon-readable
-- per their own migrations) -- so this grants no new information exposure,
-- just a different, cheaper path to read data that was already public.
create policy "search index snapshot is readable by anyone"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'search-index');
