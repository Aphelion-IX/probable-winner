-- pgTAP tests for the SKU cross-product generation query used by
-- apps/worker/src/jobs/generate-skus.ts (backlog B-051): scoped to the
-- given printing ids only (never a full-table rewrite), and idempotent —
-- generating for a printing whose SKUs already exist inserts zero new rows
-- and never touches other printings' existing rows.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(5);

create temp table test_ids_skugen (key text primary key, id uuid);

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'skugen', 'SKU Generation Test Set' from g
       returning id
     ),
     oc_a as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-0000000006a1', 'Gen Card A', 'Instant' from g
       returning id
     ),
     oc_b as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-0000000006b1', 'Gen Card B', 'Instant' from g
       returning id
     ),
     p_a as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc_a.id, s.id, 'a1', 'common', array['nonfoil', 'foil']
       from oc_a, s
       returning id
     ),
     p_b as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc_b.id, s.id, 'b1', 'common', array['nonfoil']
       from oc_b, s
       returning id
     )
insert into test_ids_skugen (key, id)
select 'printing_a', id from p_a
union all
select 'printing_b', id from p_b;

-- Generate SKUs scoped to printing A only (mirrors generateSkusForPrintings).
with target_printings as (
  select id, finishes from card_printings where id = (select id from test_ids_skugen where key = 'printing_a')
),
expanded as (
  select tp.id as card_printing_id, finish_code
  from target_printings tp, unnest(tp.finishes) as finish_code
)
insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
select
  e.card_printing_id,
  (select id from languages where code = 'en'),
  f.id,
  c.id,
  (select id from product_statuses where code = 'active')
from expanded e
join finishes f on f.code = e.finish_code
cross join conditions c
on conflict (card_printing_id, language_id, finish_id, condition_id) do nothing;

select ok(
  (select count(*) from sellable_skus where card_printing_id = (select id from test_ids_skugen where key = 'printing_a'))
    = (select count(*) from finishes where code = any(array['nonfoil', 'foil'])) * (select count(*) from conditions),
  'generating for printing A creates exactly finishes(A) x conditions SKU rows'
);
select ok(
  (select count(*) from sellable_skus where card_printing_id = (select id from test_ids_skugen where key = 'printing_b')) = 0,
  'printing B (not in scope) has zero SKUs — scoping to given printing ids only, not a full-table rewrite'
);

-- Re-run the same generation for printing A: must be a no-op (idempotent).
with target_printings as (
  select id, finishes from card_printings where id = (select id from test_ids_skugen where key = 'printing_a')
),
expanded as (
  select tp.id as card_printing_id, finish_code
  from target_printings tp, unnest(tp.finishes) as finish_code
)
insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
select
  e.card_printing_id,
  (select id from languages where code = 'en'),
  f.id,
  c.id,
  (select id from product_statuses where code = 'active')
from expanded e
join finishes f on f.code = e.finish_code
cross join conditions c
on conflict (card_printing_id, language_id, finish_id, condition_id) do nothing;

select ok(
  (select count(*) from sellable_skus where card_printing_id = (select id from test_ids_skugen where key = 'printing_a'))
    = (select count(*) from finishes where code = any(array['nonfoil', 'foil'])) * (select count(*) from conditions),
  'regenerating for the same printing is a no-op: row count is unchanged (B-051/B-052)'
);

-- Now generate for printing B (simulating a later incremental import of a
-- new printing): must add exactly B's rows and leave A's untouched.
with target_printings as (
  select id, finishes from card_printings where id = (select id from test_ids_skugen where key = 'printing_b')
),
expanded as (
  select tp.id as card_printing_id, finish_code
  from target_printings tp, unnest(tp.finishes) as finish_code
)
insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
select
  e.card_printing_id,
  (select id from languages where code = 'en'),
  f.id,
  c.id,
  (select id from product_statuses where code = 'active')
from expanded e
join finishes f on f.code = e.finish_code
cross join conditions c
on conflict (card_printing_id, language_id, finish_id, condition_id) do nothing;

select ok(
  (select count(*) from sellable_skus where card_printing_id = (select id from test_ids_skugen where key = 'printing_b'))
    = (select count(*) from finishes where code = any(array['nonfoil'])) * (select count(*) from conditions),
  'generating for printing B creates exactly its own new SKU rows'
);
select ok(
  (select count(*) from sellable_skus where card_printing_id = (select id from test_ids_skugen where key = 'printing_a'))
    = (select count(*) from finishes where code = any(array['nonfoil', 'foil'])) * (select count(*) from conditions),
  'generating for printing B touches zero of printing A''s existing SKU rows'
);

select finish();

rollback;
