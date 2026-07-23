-- pgTAP tests for inventory_balances/inventory_movements (backlog Step 7,
-- B-060): movement_type is a checked enum against blueprint §9.2's exact
-- list, inventory_balances quantity_* columns reject negative values, the
-- (fulfilment_node_id, sellable_sku_id) balance row is unique, and RLS scopes
-- reads to staff with access to that fulfilment node (same helper as
-- fulfilment_nodes itself).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(8);

create temp table test_ids_inv (key text primary key, id uuid);
grant select on test_ids_inv to authenticated;

insert into test_ids_inv (key, id)
select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_inv where key = 'org'), 'Inventory Test Store', 'invtest', 'store'
  returning id
)
insert into test_ids_inv (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'invtst', 'Inventory Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000801', 'Inventory Test Card', 'Instant' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil']
       from oc, s
       returning id
     ),
     sku as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select
         cp.id,
         (select id from languages where code = 'en'),
         (select id from finishes where code = 'nonfoil'),
         (select id from conditions where code = 'nm'),
         (select id from product_statuses where code = 'active')
       from cp
       returning id
     ),
     cp2 as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '2', 'common', array['nonfoil']
       from oc, s
       returning id
     ),
     sku2 as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select
         cp2.id,
         (select id from languages where code = 'en'),
         (select id from finishes where code = 'nonfoil'),
         (select id from conditions where code = 'nm'),
         (select id from product_statuses where code = 'active')
       from cp2
       returning id
     )
insert into test_ids_inv (key, id)
select 'sku', id from sku
union all
select 'sku2', id from sku2;

with b as (
  insert into inventory_balances (fulfilment_node_id, sellable_sku_id, quantity_on_hand)
  select (select id from test_ids_inv where key = 'node'), (select id from test_ids_inv where key = 'sku'), 5
  returning id
)
insert into test_ids_inv (key, id) select 'balance', id from b;

select ok(
  (select quantity_on_hand from inventory_balances where id = (select id from test_ids_inv where key = 'balance')) = 5,
  'inventory_balances row is created with the requested on-hand quantity'
);

-- Constraint: inventory_balances unique on (fulfilment_node_id, sellable_sku_id).
select throws_ok(
  format(
    $$insert into inventory_balances (fulfilment_node_id, sellable_sku_id) values ('%s', '%s')$$,
    (select id from test_ids_inv where key = 'node'),
    (select id from test_ids_inv where key = 'sku')
  ),
  '23505',
  null,
  'a second balance row for the same (node, sku) pair is rejected'
);

-- Constraint: quantity_on_hand (and by extension the other quantity_*
-- columns, which share the same check pattern) rejects negative values.
select throws_ok(
  format(
    $$insert into inventory_balances (fulfilment_node_id, sellable_sku_id, quantity_on_hand) values ('%s', '%s', -1)$$,
    (select id from test_ids_inv where key = 'node'),
    (select id from test_ids_inv where key = 'sku2')
  ),
  '23514',
  null,
  'a negative quantity_on_hand violates the check constraint'
);

with m as (
  insert into inventory_movements (organisation_id, fulfilment_node_id, sellable_sku_id, movement_type, quantity_delta)
  select
    (select id from test_ids_inv where key = 'org'),
    (select id from test_ids_inv where key = 'node'),
    (select id from test_ids_inv where key = 'sku'),
    'receive',
    5
  returning id
)
insert into test_ids_inv (key, id) select 'movement', id from m;

select ok(
  (select quantity_delta from inventory_movements where id = (select id from test_ids_inv where key = 'movement')) = 5,
  'inventory_movements accepts a positive quantity_delta for a receive movement'
);

-- Constraint: movement_type is a checked enum against the blueprint §9.2 list.
select throws_ok(
  format(
    $$insert into inventory_movements (organisation_id, fulfilment_node_id, sellable_sku_id, movement_type, quantity_delta)
      values ('%s', '%s', '%s', 'teleport', 1)$$,
    (select id from test_ids_inv where key = 'org'),
    (select id from test_ids_inv where key = 'node'),
    (select id from test_ids_inv where key = 'sku')
  ),
  '23514',
  null,
  'an invalid movement_type value violates the check constraint'
);

-- A negative quantity_delta (e.g. a sale) is legitimate and must not be rejected.
select lives_ok(
  format(
    $$insert into inventory_movements (organisation_id, fulfilment_node_id, sellable_sku_id, movement_type, quantity_delta)
      values ('%s', '%s', '%s', 'sale', -1)$$,
    (select id from test_ids_inv where key = 'org'),
    (select id from test_ids_inv where key = 'node'),
    (select id from test_ids_inv where key = 'sku')
  ),
  'a negative quantity_delta (a sale reducing stock) is accepted, unlike inventory_balances quantities'
);

-- RLS: an authenticated user with no staff membership at all cannot read
-- inventory data (staff_has_node_access() itself is already covered in
-- depth by staff_scope_access.test.sql — this just confirms these two
-- tables are wired to it).
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000000998', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'no-membership@test.local');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000998', true);
set local role authenticated;
select ok(
  (select count(*) from inventory_balances where id = (select id from test_ids_inv where key = 'balance')) = 0,
  'a user with no staff membership cannot read inventory_balances (RLS)'
);
select ok(
  (select count(*) from inventory_movements where id = (select id from test_ids_inv where key = 'movement')) = 0,
  'a user with no staff membership cannot read inventory_movements (RLS)'
);
reset role;

select finish();

rollback;
