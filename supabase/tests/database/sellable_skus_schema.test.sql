-- pgTAP tests for sellable_skus (backlog Step 6, B-050/B-052): the
-- (printing, language, finish, condition) tuple must be unique, and the
-- SKU id must be stable — deterministically derived from that tuple, not a
-- random UUID that changes across regenerations — since
-- inventory_balances/inventory_movements (B-060) will reference it.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(5);

select ok(
  (select count(*) from conditions) >= 5,
  'condition reference rows are seeded'
);
select ok(
  (select count(*) from languages where code = 'en') = 1,
  'english language reference row is seeded'
);
select ok(
  (select count(*) from finishes) = 3,
  'finish reference rows are seeded'
);

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'skutst', 'SKU Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-0000000005ku', 'Test Sku Card', 'Instant' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil', 'foil']
       from oc, s
       returning id
     )
insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
select
  cp.id,
  (select id from languages where code = 'en'),
  (select id from finishes where code = 'nonfoil'),
  (select id from conditions where code = 'nm'),
  (select id from product_statuses where code = 'active')
from cp;

-- Constraint: sellable_skus unique on (card_printing_id, language_id, finish_id, condition_id).
select throws_ok(
  format(
    $$insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
      values (
        '%s',
        (select id from languages where code = 'en'),
        (select id from finishes where code = 'nonfoil'),
        (select id from conditions where code = 'nm'),
        (select id from product_statuses where code = 'active')
      )$$,
    (select card_printing_id from sellable_skus limit 1)
  ),
  '23505',
  null,
  'duplicate (printing, language, finish, condition) tuple is rejected'
);

-- Stability: deleting and regenerating the same tuple yields the identical id.
select id as sku_id_before into temp sku_before from sellable_skus limit 1;

delete from sellable_skus where id = (select sku_id_before from sku_before);

insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
select
  (select id from card_printings where collector_number = '1' and set_id = (select id from sets where code = 'skutst')),
  (select id from languages where code = 'en'),
  (select id from finishes where code = 'nonfoil'),
  (select id from conditions where code = 'nm'),
  (select id from product_statuses where code = 'active')
from card_printings
where collector_number = '1' and set_id = (select id from sets where code = 'skutst')
limit 1;

select ok(
  (select id from sellable_skus
    where card_printing_id = (select id from card_printings where collector_number = '1' and set_id = (select id from sets where code = 'skutst'))
      and language_id = (select id from languages where code = 'en')
      and finish_id = (select id from finishes where code = 'nonfoil')
      and condition_id = (select id from conditions where code = 'nm')
  ) = (select sku_id_before from sku_before),
  'regenerating the same (printing, language, finish, condition) tuple yields an identical SKU id (B-052)'
);

select finish();

rollback;
