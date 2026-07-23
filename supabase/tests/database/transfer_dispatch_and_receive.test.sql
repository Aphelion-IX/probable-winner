-- pgTAP tests for transfer_orders status transitions (B-070) and
-- dispatch_transfer()/receive_transfer() (B-071/B-072).
--
-- Core ACs: an invalid status transition (Draft -> Received) is rejected;
-- stock is never available at both source and destination simultaneously
-- during transit; a transfer received as 8 good + 1 damaged + 1 missing
-- against a 10-unit request reconciles to zero unaccounted units; partial
-- receipt across multiple sessions is supported.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(14);

create temp table test_ids_tr (key text primary key, id uuid);
grant select, insert on test_ids_tr to authenticated;

insert into test_ids_tr (key, id) select 'org', id from organisations limit 1;

with src as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_tr where key = 'org'), 'Transfer Source Store', 'trsrc', 'store'
  returning id
)
insert into test_ids_tr (key, id) select 'source', id from src;

with dst as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_tr where key = 'org'), 'Transfer Dest Store', 'trdst', 'store'
  returning id
)
insert into test_ids_tr (key, id) select 'dest', id from dst;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'trtst', 'Transfer Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001101', 'Transfer Test Card', 'Instant' from g
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
insert into test_ids_tr (key, id) select 'sku', id from sku;

-- All-stores staff so this one test user has access to both source and destination.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'transfer-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_tr where key = 'org'), '00000000-0000-0000-0000-000000001102', 'system_admin', 'all_stores';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001102', true);
set local role authenticated;

select receive_inventory((select id from test_ids_tr where key = 'source'), (select id from test_ids_tr where key = 'sku'), 10, 'test', null, 'seed 10 at source');

-- B-070: invalid status transition is rejected.
with t0 as (
  insert into transfer_orders (organisation_id, source_fulfilment_node_id, destination_fulfilment_node_id)
  select (select id from test_ids_tr where key = 'org'), (select id from test_ids_tr where key = 'source'), (select id from test_ids_tr where key = 'dest')
  returning id
)
insert into test_ids_tr (key, id) select 'draft_transfer', id from t0;

select throws_ok(
  format($$update transfer_orders set status = 'received' where id = '%s'$$, (select id from test_ids_tr where key = 'draft_transfer')),
  '23514',
  null,
  'Draft -> Received is rejected as an invalid status transition (B-070 core AC)'
);
select lives_ok(
  format($$update transfer_orders set status = 'requested' where id = '%s'$$, (select id from test_ids_tr where key = 'draft_transfer')),
  'Draft -> Requested is a valid transition'
);

-- Main transfer: request 10 units, walk through the workflow states.
with t as (
  insert into transfer_orders (organisation_id, source_fulfilment_node_id, destination_fulfilment_node_id, status)
  select (select id from test_ids_tr where key = 'org'), (select id from test_ids_tr where key = 'source'), (select id from test_ids_tr where key = 'dest'), 'requested'
  returning id
)
insert into test_ids_tr (key, id) select 'transfer', id from t;

insert into transfer_order_lines (transfer_order_id, sellable_sku_id, quantity_requested)
values ((select id from test_ids_tr where key = 'transfer'), (select id from test_ids_tr where key = 'sku'), 10);

update transfer_orders set status = 'accepted' where id = (select id from test_ids_tr where key = 'transfer');

-- dispatch_transfer requires 'picking' status.
select throws_ok(
  format($$select dispatch_transfer('%s')$$, (select id from test_ids_tr where key = 'transfer')),
  null,
  format('dispatch_transfer: transfer order %s is accepted, not picking -- cannot dispatch', (select id from test_ids_tr where key = 'transfer')),
  'dispatch_transfer rejects a transfer not yet in picking status'
);

update transfer_orders set status = 'picking' where id = (select id from test_ids_tr where key = 'transfer');

with shp as (
  select dispatch_transfer((select id from test_ids_tr where key = 'transfer')) as s
)
insert into test_ids_tr (key, id) select 'shipment', (s).id from shp;

select ok(
  (select status = 'dispatched' from transfer_orders where id = (select id from test_ids_tr where key = 'transfer')),
  'dispatch_transfer moves the transfer order to dispatched status'
);
select ok(
  (
    select quantity_on_hand = 0 and quantity_available_online = 0
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_tr where key = 'source')
      and sellable_sku_id = (select id from test_ids_tr where key = 'sku')
  ),
  'dispatch removes the dispatched quantity from source availability'
);
select ok(
  (
    select count(*) = 0 from inventory_balances
    where fulfilment_node_id = (select id from test_ids_tr where key = 'dest')
      and sellable_sku_id = (select id from test_ids_tr where key = 'sku')
  ),
  'stock is not available at the destination while in transit -- no balance row exists there yet (B-071 core invariant)'
);
select ok(
  (
    select count(*) = 1 from inventory_movements
    where fulfilment_node_id = (select id from test_ids_tr where key = 'source')
      and sellable_sku_id = (select id from test_ids_tr where key = 'sku')
      and movement_type = 'transfer_out'
      and quantity_delta = -10
  ),
  'dispatch writes a single transfer_out movement for the full dispatched quantity'
);

-- Receive as 8 good + 1 damaged + 1 missing -- reconciles to zero unaccounted.
select * from receive_transfer(
  (select id from test_ids_tr where key = 'transfer'),
  jsonb_build_array(jsonb_build_object(
    'sellableSkuId', (select id from test_ids_tr where key = 'sku'),
    'quantityGood', 8, 'quantityDamaged', 1, 'quantityMissing', 1
  ))
);

select ok(
  (select status = 'received' from transfer_orders where id = (select id from test_ids_tr where key = 'transfer')),
  '8 good + 1 damaged + 1 missing against a 10-unit request fully reconciles the transfer (B-072 core AC)'
);
select ok(
  (
    select quantity_on_hand = 8 and quantity_available_online = 8
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_tr where key = 'dest')
      and sellable_sku_id = (select id from test_ids_tr where key = 'sku')
  ),
  'only the good quantity becomes available stock at the destination'
);
select ok(
  (
    select sum(quantity_good + quantity_damaged + quantity_missing) = 10 from transfer_receipts
    where transfer_order_id = (select id from test_ids_tr where key = 'transfer')
  ),
  'damaged and missing units are recorded, not silently dropped -- 8+1+1 accounts for all 10 units'
);

-- Partial receipt across two separate sessions on a second transfer.
with t2 as (
  insert into transfer_orders (organisation_id, source_fulfilment_node_id, destination_fulfilment_node_id, status)
  select (select id from test_ids_tr where key = 'org'), (select id from test_ids_tr where key = 'source'), (select id from test_ids_tr where key = 'dest'), 'picking'
  returning id
)
insert into test_ids_tr (key, id) select 'transfer2', id from t2;

select receive_inventory((select id from test_ids_tr where key = 'source'), (select id from test_ids_tr where key = 'sku'), 6, 'test', null, 'seed 6 more at source');

insert into transfer_order_lines (transfer_order_id, sellable_sku_id, quantity_requested)
values ((select id from test_ids_tr where key = 'transfer2'), (select id from test_ids_tr where key = 'sku'), 6);

select dispatch_transfer((select id from test_ids_tr where key = 'transfer2'));

select * from receive_transfer(
  (select id from test_ids_tr where key = 'transfer2'),
  jsonb_build_array(jsonb_build_object('sellableSkuId', (select id from test_ids_tr where key = 'sku'), 'quantityGood', 4))
);
select ok(
  (select status = 'partially_received' from transfer_orders where id = (select id from test_ids_tr where key = 'transfer2')),
  'receiving only 4 of 6 requested units marks the transfer partially_received'
);

-- Over-receiving beyond what remains is rejected.
select throws_ok(
  format(
    $$select * from receive_transfer('%s', jsonb_build_array(jsonb_build_object('sellableSkuId', '%s', 'quantityGood', 3)))$$,
    (select id from test_ids_tr where key = 'transfer2'),
    (select id from test_ids_tr where key = 'sku')
  ),
  null,
  null,
  'receiving more than the remaining unaccounted quantity (3 when only 2 remain) is rejected'
);

select * from receive_transfer(
  (select id from test_ids_tr where key = 'transfer2'),
  jsonb_build_array(jsonb_build_object('sellableSkuId', (select id from test_ids_tr where key = 'sku'), 'quantityGood', 2))
);
select ok(
  (select status = 'received' from transfer_orders where id = (select id from test_ids_tr where key = 'transfer2')),
  'the second receiving session completes the transfer (4 + 2 = 6)'
);
select ok(
  (
    select quantity_on_hand = 14
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_tr where key = 'dest')
      and sellable_sku_id = (select id from test_ids_tr where key = 'sku')
  ),
  'destination on-hand accumulates correctly across both transfers and both receiving sessions (8 + 4 + 2 = 14)'
);

reset role;

select finish();

rollback;
