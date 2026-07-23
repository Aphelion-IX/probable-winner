-- Pricing adapter mapping exceptions (backlog B-152).
-- When a pricing adapter cannot map a card (e.g., TCGPlayer cannot find a product,
-- Card Kingdom requires oracle_id but none is present), the exception is recorded
-- here instead of being silently dropped. This audit trail helps identify why
-- certain cards lack pricing data (blueprint §15.2).

create table price_import_exceptions (
  id uuid primary key default gen_random_uuid(),
  card_id text not null,
  source text not null check (source in ('tcgplayer', 'card_kingdom', 'mtgjson', 'cardmarket')),
  reason text not null,
  recorded_at timestamptz not null default now()
);

create index price_import_exceptions_card_source_idx on price_import_exceptions (card_id, source);
create index price_import_exceptions_source_idx on price_import_exceptions (source);
create index price_import_exceptions_recorded_idx on price_import_exceptions (recorded_at desc);
