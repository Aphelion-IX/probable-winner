-- pgTAP tests for create_pick_batch()'s location-based sort (backlog
-- B-141). Run via `supabase test db` once the local Supabase CLI/Docker
-- stack is available -- wrapped in BEGIN/ROLLBACK so no fixture data is
-- left behind.
begin;

select plan(3);

create temp table test_ids_lspb (key text primary key, id uuid);
grant select, insert on test_ids_lspb to authenticated;

insert into test_ids_lspb (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_lspb where key = 'org'), 'Location Sort Test Store', 'lsptest', 'store'
  returning id
)
insert into test_ids_lspb (key, id) select 'node', id from n;

-- Two storage locations, deliberately named so an alphabetic/code sort is
-- unambiguous regardless of the SKUs' randomly generated UUIDs.
with sl as (
  insert into storage_locations (fulfilment_node_id, code)
  select (select id from test_ids_lspb where key = 'node'), 'A01'
  returning id
)
insert into test_ids_lspb (key, id) select 'location_a01', id from sl;

with sl as (
  insert into storage_locations (fulfilment_node_id, code)
  select (select id from test_ids_lspb where key = 'node'), 'B02'
  returning id
)
insert into test_ids_lspb (key, id) select 'location_b02', id from sl;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'lspt1', 'Location Sort Test Set 1' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000e01', 'Location Sort Test Card A', 'Instant' from g
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
       select cp.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp returning id
     )
insert into test_ids_lspb (key, id) select 'sku_a', id from sku;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'lspt2', 'Location Sort Test Set 2' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000e02', 'Location Sort Test Card B', 'Instant' from g
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
       select cp.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp returning id
     )
insert into test_ids_lspb (key, id) select 'sku_b', id from sku;

-- A single order with two lines, inserted here (before the role switch to
-- 'authenticated' below) since orders/order_lines have no INSERT policy --
-- the app only ever writes them via a service-role client. Both
-- allocations will therefore share the same order_id, so the *old* sort
-- (order_id, sellable_sku_id) would order them by their random SKU UUIDs,
-- not by location.
with o as (
  insert into orders (organisation_id, fulfilment_node_id, order_number, fulfilment_type, total_amount, currency)
  select (select id from test_ids_lspb where key = 'org'), (select id from test_ids_lspb where key = 'node'), 'LSPB-TEST-1', 'online_shipping', 0, 'AUD'
  returning id
)
insert into test_ids_lspb (key, id) select 'order', id from o;

with ol as (
  insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total)
  select (select id from test_ids_lspb where key = 'order'), (select id from test_ids_lspb where key = 'sku_a'), 1, 10, 10
  returning id
)
insert into test_ids_lspb (key, id) select 'order_line_a', id from ol;

with ol as (
  insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total)
  select (select id from test_ids_lspb where key = 'order'), (select id from test_ids_lspb where key = 'sku_b'), 1, 10, 10
  returning id
)
insert into test_ids_lspb (key, id) select 'order_line_b', id from ol;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000000e03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lspb-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_lspb where key = 'org'), '00000000-0000-0000-0000-000000000e03', 'inventory_manager', 'store', (select id from test_ids_lspb where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000e03', true);
set local role authenticated;

-- Seed stock for both SKUs and place SKU A at location B02, SKU B at
-- location A01 -- the opposite of alphabetic SKU-id order, so a passing
-- test can only mean the sort genuinely follows location code, not an
-- accidental match with the old order_id/sku_id sort.
select receive_inventory((select id from test_ids_lspb where key = 'node'), (select id from test_ids_lspb where key = 'sku_a'), 1, 'test', null, 'seed sku a');
select receive_inventory((select id from test_ids_lspb where key = 'node'), (select id from test_ids_lspb where key = 'sku_b'), 1, 'test', null, 'seed sku b');

update inventory_balances set storage_location_id = (select id from test_ids_lspb where key = 'location_b02')
where fulfilment_node_id = (select id from test_ids_lspb where key = 'node')
  and sellable_sku_id = (select id from test_ids_lspb where key = 'sku_a');

update inventory_balances set storage_location_id = (select id from test_ids_lspb where key = 'location_a01')
where fulfilment_node_id = (select id from test_ids_lspb where key = 'node')
  and sellable_sku_id = (select id from test_ids_lspb where key = 'sku_b');

with r as (
  select reserve_inventory((select id from test_ids_lspb where key = 'node'), (select id from test_ids_lspb where key = 'sku_a'), 1) as res
)
insert into test_ids_lspb (key, id) select 'reservation_a', (res).id from r;

with r as (
  select reserve_inventory((select id from test_ids_lspb where key = 'node'), (select id from test_ids_lspb where key = 'sku_b'), 1) as res
)
insert into test_ids_lspb (key, id) select 'reservation_b', (res).id from r;

with a as (
  select allocate_order_inventory(
    (select id from test_ids_lspb where key = 'reservation_a'),
    (select id from test_ids_lspb where key = 'order_line_a')
  ) as alloc
)
insert into test_ids_lspb (key, id) select 'allocation_a', (alloc).id from a;

with a as (
  select allocate_order_inventory(
    (select id from test_ids_lspb where key = 'reservation_b'),
    (select id from test_ids_lspb where key = 'order_line_b')
  ) as alloc
)
insert into test_ids_lspb (key, id) select 'allocation_b', (alloc).id from a;

with b as (
  select create_pick_batch((select id from test_ids_lspb where key = 'node')) as id
)
insert into test_ids_lspb (key, id) select 'batch', id from b;

select ok(
  (select count(*) = 2 from pick_lines where pick_batch_id = (select id from test_ids_lspb where key = 'batch')),
  'create_pick_batch creates one pick_line per pending allocation'
);

-- SKU B sits at location A01 (code sorts first) -- its pick_line must
-- come before SKU A's (location B02), the reverse of what an
-- order_id/sku_id-only sort would guarantee.
select ok(
  (
    select b_line.sort_order < a_line.sort_order
    from pick_lines a_line, pick_lines b_line
    where a_line.allocation_id = (select id from test_ids_lspb where key = 'allocation_a')
      and b_line.allocation_id = (select id from test_ids_lspb where key = 'allocation_b')
  ),
  'pick_lines are ordered by storage location code (A01 before B02), not by order_id/sku_id'
);

select ok(
  (
    select array_agg(sl.code order by pl.sort_order) = array['A01', 'B02']
    from pick_lines pl
    join inventory_balances ib on ib.fulfilment_node_id = (select id from test_ids_lspb where key = 'node')
      and ib.sellable_sku_id = pl.sku_id
    join storage_locations sl on sl.id = ib.storage_location_id
    where pl.pick_batch_id = (select id from test_ids_lspb where key = 'batch')
  ),
  'pick_lines walk the store in location-code order (A01 then B02)'
);

reset role;

select finish();

rollback;
