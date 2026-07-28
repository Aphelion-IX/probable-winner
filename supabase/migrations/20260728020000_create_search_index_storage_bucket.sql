-- Storage bucket for the worker's persisted MiniSearch snapshot (replacing
-- Typesense, which held this state in its own external service -- MiniSearch
-- is a library, so the worker process holds the live index in memory and
-- persists a snapshot here so a restart doesn't require a full rebuild from
-- Postgres). This bucket has never existed before; this project has had no
-- use for Supabase Storage until now (card images are external Scryfall
-- URLs, never mirrored into storage).
--
-- Private (public = false) and no RLS policy on storage.objects for this
-- bucket at all -- same convention as inventory_balances' insert/update/
-- delete (20260723054622_inventory_balances_and_movements.sql: "no
-- insert/update/delete RLS policy exists ... there is no supported write
-- path at all"). anon/authenticated get no access whatsoever; service_role
-- bypasses RLS entirely (Postgres BYPASSRLS), which is exactly the access
-- the worker needs and the only access this snapshot should ever have --
-- it contains full pricing/stock/availability data across every store, not
-- something to expose even read-only to browser-facing roles.
insert into storage.buckets (id, name, public)
values ('search-index', 'search-index', false)
on conflict (id) do nothing;
