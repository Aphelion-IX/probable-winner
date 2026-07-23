-- price_snapshots (blueprint §8.6/§15.2/§15.3, backlog B-151). One row per
-- successfully-mapped ImportedPrice -- shape matches the ImportedPrice type
-- in blueprint §15.2 field-for-field. Immutable: rows are inserted once by
-- the import job and never updated, same convention as inventory_movements
-- (20260723054622) -- a later price observation is a new row, not an edit
-- of an old one. There is no update/delete RLS policy for any app-facing
-- role below (only select), and the worker's own writes go through its
-- direct Postgres connection (bypasses RLS) exactly like the catalogue
-- importer's staging writes -- nothing here ever issues an UPDATE against
-- this table.
--
-- A staging row that cannot be resolved to a card_printing_id (backlog
-- B-152's "mapping exceptions ... recorded, not dropped") becomes a
-- price_import_errors row instead of a snapshot with a null printing --
-- so card_printing_id is not-null here by design.

create table price_snapshots (
  id uuid primary key default gen_random_uuid(),
  price_import_run_id uuid not null references price_import_runs(id) on delete cascade,
  price_source_id uuid not null references price_sources(id) on delete cascade,
  provider text not null,
  source_product_id text not null,
  source_sku_id text,
  card_printing_id uuid not null references card_printings(id) on delete cascade,
  scryfall_id uuid,
  set_code text,
  collector_number text,
  language text not null,
  finish text not null check (finish in ('normal', 'foil', 'etched')),
  condition text check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),
  price_type text not null check (price_type in ('market', 'low', 'retail', 'buylist', 'recent_sale')),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index price_snapshots_run_idx on price_snapshots (price_import_run_id);
-- Backs "latest price for this printing/provider/type/finish" lookups, the
-- access pattern the eventual pricing engine (backlog B-160/161) needs.
create index price_snapshots_printing_latest_idx
  on price_snapshots (card_printing_id, provider, price_type, finish, observed_at desc);
