-- pgTAP tests for 20260726060000_wire_up_picking_packing_shipment_workflow.sql
-- (2026-07-26 security re-audit item 9 follow-up): record_pick_line_scan()
-- actually converting a pick into removed inventory, complete_pick_batch()
-- refusing to complete a batch with unpicked lines, create_shipment()
-- refusing to pack an unfinished pick, and every order-status transition
-- through picking -> packed -> dispatched -> shipped, including the
-- customer-facing `shipments` row mark_shipment_shipped() now writes.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(14);

create temp table test_ids_pps (key text primary key, id uuid);
grant select, insert on test_ids_pps to authenticated;

insert into test_ids_pps (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_pps where key = 'org'), 'PPS Test Store', 'ppstest', 'store'
  returning id
)
insert into test_ids_pps (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'ppst1', 'PPS Test Set 1' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000f01', 'PPS Test Card A', 'Instant' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil'] from oc, s returning id
     ),
     sku as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select cp.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp returning id
     )
insert into test_ids_pps (key, id) select 'sku_a', id from sku;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'ppst2', 'PPS Test Set 2' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000f02', 'PPS Test Card B', 'Instant' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil'] from oc, s returning id
     ),
     sku as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select cp.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp returning id
     )
insert into test_ids_pps (key, id) select 'sku_b', id from sku;

-- One order, two lines -- orders/order_lines have no INSERT policy (the
-- app only writes them via a service-role client/create_pending_order()),
-- so this runs before the role switch to 'authenticated' below.
with o as (
  insert into orders (organisation_id, fulfilment_node_id, order_number, status, fulfilment_type, total_amount, currency)
  select (select id from test_ids_pps where key = 'org'), (select id from test_ids_pps where key = 'node'), 'PPS-TEST-1', 'paid', 'online_shipping', 20, 'AUD'
  returning id
)
insert into test_ids_pps (key, id) select 'order', id from o;

with ol as (
  insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total)
  select (select id from test_ids_pps where key = 'order'), (select id from test_ids_pps where key = 'sku_a'), 1, 10, 10
  returning id
)
insert into test_ids_pps (key, id) select 'order_line_a', id from ol;

with ol as (
  insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total)
  select (select id from test_ids_pps where key = 'order'), (select id from test_ids_pps where key = 'sku_b'), 1, 10, 10
  returning id
)
insert into test_ids_pps (key, id) select 'order_line_b', id from ol;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000000f03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pps-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_pps where key = 'org'), '00000000-0000-0000-0000-000000000f03', 'inventory_manager', 'store', (select id from test_ids_pps where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000f03', true);
set local role authenticated;

select receive_inventory((select id from test_ids_pps where key = 'node'), (select id from test_ids_pps where key = 'sku_a'), 1, 'test', null, 'seed sku a');
select receive_inventory((select id from test_ids_pps where key = 'node'), (select id from test_ids_pps where key = 'sku_b'), 1, 'test', null, 'seed sku b');

-- reserve_inventory() is no longer granted to authenticated/anon
-- (2026-07-26 security re-audit item 1) -- called here as the default
-- (superuser) role, restoring authenticated afterward for
-- allocate_order_inventory().
reset role;
with r as (
  select reserve_inventory((select id from test_ids_pps where key = 'node'), (select id from test_ids_pps where key = 'sku_a'), 1) as res
)
insert into test_ids_pps (key, id) select 'reservation_a', (res).id from r;

with r as (
  select reserve_inventory((select id from test_ids_pps where key = 'node'), (select id from test_ids_pps where key = 'sku_b'), 1) as res
)
insert into test_ids_pps (key, id) select 'reservation_b', (res).id from r;
set local role authenticated;

with a as (
  select allocate_order_inventory(
    (select id from test_ids_pps where key = 'reservation_a'),
    (select id from test_ids_pps where key = 'order_line_a')
  ) as alloc
)
insert into test_ids_pps (key, id) select 'allocation_a', (alloc).id from a;

with a as (
  select allocate_order_inventory(
    (select id from test_ids_pps where key = 'reservation_b'),
    (select id from test_ids_pps where key = 'order_line_b')
  ) as alloc
)
insert into test_ids_pps (key, id) select 'allocation_b', (alloc).id from a;

with b as (
  select create_pick_batch((select id from test_ids_pps where key = 'node')) as id
)
insert into test_ids_pps (key, id) select 'batch', id from b;

-- begin_pick_batch: moves the covered order from 'paid' to 'picking'.
select begin_pick_batch((select id from test_ids_pps where key = 'batch'));
select ok(
  (select status = 'picking' from orders where id = (select id from test_ids_pps where key = 'order')),
  'begin_pick_batch moves the covered order from paid to picking'
);

-- Scan line A to completion (quantity_to_pick = 1): the allocation must
-- actually leave the picking bucket and quantity_on_hand, not just flip a
-- flag on pick_lines. Resolve the real pick_lines ids first (create_pick_batch
-- generates them, they aren't the order_line ids).
with pl as (
  select id from pick_lines
  where pick_batch_id = (select id from test_ids_pps where key = 'batch')
    and order_line_id = (select id from test_ids_pps where key = 'order_line_a')
)
insert into test_ids_pps (key, id) select 'pick_line_a', id from pl;

with pl as (
  select id from pick_lines
  where pick_batch_id = (select id from test_ids_pps where key = 'batch')
    and order_line_id = (select id from test_ids_pps where key = 'order_line_b')
)
insert into test_ids_pps (key, id) select 'pick_line_b', id from pl;

select record_pick_line_scan((select id from test_ids_pps where key = 'pick_line_a'));

select ok(
  (
    select quantity_picked = 1 and scan_count = 1
    from pick_lines where id = (select id from test_ids_pps where key = 'pick_line_a')
  ),
  'record_pick_line_scan increments quantity_picked and scan_count on the real pick_lines row'
);
select ok(
  (
    select status = 'picked'
    from inventory_allocations where id = (select id from test_ids_pps where key = 'allocation_a')
  ),
  'a fully-scanned line converts its allocation to picked (begin_inventory_pick + complete_inventory_pick both ran)'
);
select ok(
  (
    select quantity_on_hand = 0
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_pps where key = 'node')
      and sellable_sku_id = (select id from test_ids_pps where key = 'sku_a')
  ),
  'the picked unit actually left quantity_on_hand, not just a UI flag'
);

-- complete_pick_batch refuses while line B is still unpicked.
select throws_ok(
  format($$select complete_pick_batch('%s')$$, (select id from test_ids_pps where key = 'batch')),
  null,
  format('complete_pick_batch: batch %s still has unpicked lines', (select id from test_ids_pps where key = 'batch')),
  'complete_pick_batch refuses to complete a batch with an unpicked line'
);

-- create_shipment refuses on a batch that isn't completed yet.
select throws_ok(
  format($$select create_shipment('%s')$$, (select id from test_ids_pps where key = 'batch')),
  null,
  format('create_shipment: batch %s is in_progress, not completed -- cannot pack an unfinished pick', (select id from test_ids_pps where key = 'batch')),
  'create_shipment refuses to pack a batch that is still in_progress'
);

-- Finish picking line B, then complete the batch for real.
select record_pick_line_scan((select id from test_ids_pps where key = 'pick_line_b'));
select complete_pick_batch((select id from test_ids_pps where key = 'batch'));

select ok(
  (select status = 'completed' from pick_batches where id = (select id from test_ids_pps where key = 'batch')),
  'complete_pick_batch succeeds once every line is fully picked'
);

-- create_shipment now succeeds and moves the order to 'packed'.
with s as (
  select create_shipment((select id from test_ids_pps where key = 'batch'), 'auspost') as shipment
)
insert into test_ids_pps (key, id) select 'shipment', (shipment).id from s;

select ok(
  (select status = 'packed' from orders where id = (select id from test_ids_pps where key = 'order')),
  'create_shipment moves the covered order from picking to packed'
);
select ok(
  (select count(*) = 1 from packing_shipments where id = (select id from test_ids_pps where key = 'shipment')),
  'create_shipment creates exactly one packing_shipments row'
);

-- generate_shipment_label moves the order to 'dispatched'.
select generate_shipment_label((select id from test_ids_pps where key = 'shipment'), 'TRACK123', null);

select ok(
  (select status = 'dispatched' from orders where id = (select id from test_ids_pps where key = 'order')),
  'generate_shipment_label moves the covered order from packed to dispatched'
);
select ok(
  (
    select status = 'labeled' and tracking_number = 'TRACK123'
    from packing_shipments where id = (select id from test_ids_pps where key = 'shipment')
  ),
  'generate_shipment_label records the tracking number on packing_shipments'
);

-- mark_shipment_shipped moves the order to 'shipped' and writes the
-- customer-facing shipments row -- previously this never happened at all.
select mark_shipment_shipped((select id from test_ids_pps where key = 'shipment'));

select ok(
  (select status = 'shipped' from orders where id = (select id from test_ids_pps where key = 'order')),
  'mark_shipment_shipped moves the covered order from dispatched to shipped'
);
select ok(
  (
    select tracking_number = 'TRACK123' and carrier = 'auspost' and carrier_status = 'shipped' and shipped_at is not null
    from shipments where order_id = (select id from test_ids_pps where key = 'order')
  ),
  'mark_shipment_shipped writes the customer-facing shipments row with tracking/carrier info'
);
select ok(
  (
    select status = 'shipped'
    from packing_shipments where id = (select id from test_ids_pps where key = 'shipment')
  ),
  'mark_shipment_shipped marks the packing_shipments row itself shipped'
);

reset role;

select finish();

rollback;
