-- pgTAP tests for allocate_order_inventory()/begin_inventory_pick()/
-- complete_inventory_pick() (backlog B-063).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(10);

create temp table test_ids_ap (key text primary key, id uuid);
grant select, insert on test_ids_ap to authenticated;

insert into test_ids_ap (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_ap where key = 'org'), 'Allocate Pick Test Store', 'aptest', 'store'
  returning id
)
insert into test_ids_ap (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'aptst', 'Allocate Pick Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000d01', 'Allocate Pick Test Card', 'Instant' from g
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
insert into test_ids_ap (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ap-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_ap where key = 'org'), '00000000-0000-0000-0000-000000000d02', 'inventory_manager', 'store', (select id from test_ids_ap where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000d02', true);
set local role authenticated;

select receive_inventory(
  (select id from test_ids_ap where key = 'node'),
  (select id from test_ids_ap where key = 'sku'),
  1, 'test', null, 'seed one unit'
);

with r as (
  select reserve_inventory(
    (select id from test_ids_ap where key = 'node'),
    (select id from test_ids_ap where key = 'sku'),
    1
  ) as res
)
insert into test_ids_ap (key, id) select 'reservation', (res).id from r;

with a as (
  select allocate_order_inventory((select id from test_ids_ap where key = 'reservation')) as alloc
)
insert into test_ids_ap (key, id) select 'allocation', (alloc).id from a;

select ok(
  (select status = 'allocated' and quantity = 1 from inventory_allocations where id = (select id from test_ids_ap where key = 'allocation')),
  'allocate_order_inventory creates an allocated allocation for the reservation quantity'
);
select ok(
  (select status = 'converted' from inventory_reservations where id = (select id from test_ids_ap where key = 'reservation')),
  'allocate_order_inventory converts the source reservation'
);
select ok(
  (
    select quantity_reserved = 0 and quantity_allocated = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_ap where key = 'node')
      and sellable_sku_id = (select id from test_ids_ap where key = 'sku')
  ),
  'allocation moves the balance from reserved to allocated'
);

-- AC: completing a pick that was never begun fails with a clear error, not
-- a silent no-op.
select throws_ok(
  format($$select complete_inventory_pick('%s')$$, (select id from test_ids_ap where key = 'allocation')),
  null,
  'complete_inventory_pick: allocation ' || (select id from test_ids_ap where key = 'allocation') || ' is allocated, not picking -- cannot complete a pick that was never begun (or was already completed)',
  'completing a pick that was never begun is rejected, not silently ignored'
);

select begin_inventory_pick((select id from test_ids_ap where key = 'allocation'));

select ok(
  (select status = 'picking' from inventory_allocations where id = (select id from test_ids_ap where key = 'allocation')),
  'begin_inventory_pick moves the allocation to picking status'
);
select ok(
  (
    select quantity_allocated = 0 and quantity_picking = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_ap where key = 'node')
      and sellable_sku_id = (select id from test_ids_ap where key = 'sku')
  ),
  'begin_inventory_pick moves the balance from allocated to picking'
);

-- AC: begin_inventory_pick cannot be called again on an already-picking allocation.
select throws_ok(
  format($$select begin_inventory_pick('%s')$$, (select id from test_ids_ap where key = 'allocation')),
  null,
  'begin_inventory_pick: allocation ' || (select id from test_ids_ap where key = 'allocation') || ' is picking, not allocated -- cannot begin picking',
  'beginning a pick twice on the same allocation is rejected'
);

select complete_inventory_pick((select id from test_ids_ap where key = 'allocation'));

select ok(
  (select status = 'picked' from inventory_allocations where id = (select id from test_ids_ap where key = 'allocation')),
  'complete_inventory_pick marks the allocation picked'
);
select ok(
  (
    select quantity_picking = 0 and quantity_on_hand = 0
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_ap where key = 'node')
      and sellable_sku_id = (select id from test_ids_ap where key = 'sku')
  ),
  'complete_inventory_pick clears the picking bucket and removes the unit from on-hand stock'
);

-- AC: a completed pick cannot be re-completed.
select throws_ok(
  format($$select complete_inventory_pick('%s')$$, (select id from test_ids_ap where key = 'allocation')),
  null,
  'complete_inventory_pick: allocation ' || (select id from test_ids_ap where key = 'allocation') || ' is picked, not picking -- cannot complete a pick that was never begun (or was already completed)',
  'completing an already-completed pick is rejected, not a silent no-op'
);

reset role;

select finish();

rollback;
