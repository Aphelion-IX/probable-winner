-- pgTAP tests for audit log coverage (backlog B-204): every state-changing
-- atomic function across inventory (B-061-B-063), transfers (B-071), and
-- pricing approvals (B-163-B-164) writes exactly one audit_events row per
-- call, in the same transaction as the change -- and a rolled-back call
-- leaves no orphaned row, same invariant as integration_events_outbox.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available.
begin;

select plan(19);

create temp table test_ids_ae (key text primary key, id uuid);
grant select, insert on test_ids_ae to authenticated;

insert into test_ids_ae (key, id) select 'org', id from organisations limit 1;

with src as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_ae where key = 'org'), 'Audit Source Store', 'aesrc', 'store'
  returning id
)
insert into test_ids_ae (key, id) select 'source', id from src;

with dst as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_ae where key = 'org'), 'Audit Dest Store', 'aedst', 'store'
  returning id
)
insert into test_ids_ae (key, id) select 'dest', id from dst;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'aetst', 'Audit Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001301', 'Audit Test Card', 'Instant' from g
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
insert into test_ids_ae (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_ae where key = 'org'), '00000000-0000-0000-0000-000000001302', 'system_admin', 'all_stores';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001302', true);
set local role authenticated;

-- ============================================================================
-- Inventory: walk one unit through the full lifecycle, checking one
-- audit_events row appears per state-changing call.
-- ============================================================================

select receive_inventory((select id from test_ids_ae where key = 'source'), (select id from test_ids_ae where key = 'sku'), 20, 'test', null, 'seed');
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.receive' and entity_type = 'inventory_movement'),
  'receive_inventory() writes one audit_events row'
);

select adjust_inventory((select id from test_ids_ae where key = 'source'), (select id from test_ids_ae where key = 'sku'), 'damage', -1, 'crushed corner');
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.adjust' and entity_type = 'inventory_movement'),
  'adjust_inventory() writes one audit_events row'
);

with r as (
  select reserve_inventory((select id from test_ids_ae where key = 'source'), (select id from test_ids_ae where key = 'sku'), 5) as res
)
insert into test_ids_ae (key, id) select 'reservation', (res).id from r;
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.reserve' and entity_id = (select id from test_ids_ae where key = 'reservation')),
  'reserve_inventory() writes one audit_events row keyed to the reservation'
);

with a as (
  select allocate_order_inventory((select id from test_ids_ae where key = 'reservation')) as alloc
)
insert into test_ids_ae (key, id) select 'allocation', (alloc).id from a;
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.allocate' and entity_id = (select id from test_ids_ae where key = 'allocation')),
  'allocate_order_inventory() writes one audit_events row keyed to the allocation'
);

select begin_inventory_pick((select id from test_ids_ae where key = 'allocation'));
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.begin_pick' and entity_id = (select id from test_ids_ae where key = 'allocation')),
  'begin_inventory_pick() writes one audit_events row'
);

select complete_inventory_pick((select id from test_ids_ae where key = 'allocation'));
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.complete_pick' and entity_id = (select id from test_ids_ae where key = 'allocation')),
  'complete_inventory_pick() writes one audit_events row'
);

-- Separate reserve/release pair (independent of the allocate/pick one above).
with r2 as (
  select reserve_inventory((select id from test_ids_ae where key = 'source'), (select id from test_ids_ae where key = 'sku'), 2) as res
)
insert into test_ids_ae (key, id) select 'reservation2', (res).id from r2;
select release_inventory_reservation((select id from test_ids_ae where key = 'reservation2'));
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.release_reservation' and entity_id = (select id from test_ids_ae where key = 'reservation2')),
  'release_inventory_reservation() writes one audit_events row'
);

with q as (
  select quarantine_inventory((select id from test_ids_ae where key = 'source'), (select id from test_ids_ae where key = 'sku'), 3, 'suspected counterfeit') as qi
)
insert into test_ids_ae (key, id) select 'quarantine', (qi).id from q;
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.quarantine' and entity_id = (select id from test_ids_ae where key = 'quarantine')),
  'quarantine_inventory() writes one audit_events row'
);

select release_inventory_quarantine((select id from test_ids_ae where key = 'quarantine'));
select ok(
  (select count(*) = 1 from audit_events where action = 'inventory.release_quarantine' and entity_id = (select id from test_ids_ae where key = 'quarantine')),
  'release_inventory_quarantine() writes one audit_events row'
);

-- A rolled-back atomic-function call leaves no orphaned audit row.
select throws_ok(
  format(
    $$select reserve_inventory('%s', '%s', 999999)$$,
    (select id from test_ids_ae where key = 'source'),
    (select id from test_ids_ae where key = 'sku')
  ),
  '23514',
  null,
  'reserving far more than available fails as expected, setting up the orphan-audit-row check'
);
select ok(
  (select count(*) = 0 from audit_events where action = 'inventory.reserve' and metadata ->> 'quantity' = '999999'),
  'the rolled-back reserve_inventory call left no orphaned audit_events row'
);

-- ============================================================================
-- Transfers
-- ============================================================================

with t as (
  insert into transfer_orders (organisation_id, source_fulfilment_node_id, destination_fulfilment_node_id, status)
  select (select id from test_ids_ae where key = 'org'), (select id from test_ids_ae where key = 'source'), (select id from test_ids_ae where key = 'dest'), 'picking'
  returning id
)
insert into test_ids_ae (key, id) select 'transfer', id from t;

insert into transfer_order_lines (transfer_order_id, sellable_sku_id, quantity_requested)
values ((select id from test_ids_ae where key = 'transfer'), (select id from test_ids_ae where key = 'sku'), 4);

select dispatch_transfer((select id from test_ids_ae where key = 'transfer'));
select ok(
  (select count(*) = 1 from audit_events where action = 'transfer.dispatch' and metadata ->> 'transferOrderId' = (select id::text from test_ids_ae where key = 'transfer')),
  'dispatch_transfer() writes one audit_events row per dispatched line'
);

select * from receive_transfer(
  (select id from test_ids_ae where key = 'transfer'),
  jsonb_build_array(jsonb_build_object('sellableSkuId', (select id from test_ids_ae where key = 'sku'), 'quantityGood', 4))
);
select ok(
  (select count(*) = 1 from audit_events where action = 'transfer.receive' and metadata ->> 'transferOrderId' = (select id::text from test_ids_ae where key = 'transfer')),
  'receive_transfer() writes one audit_events row per receipt line'
);

-- ============================================================================
-- Pricing approvals
-- ============================================================================

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  values ((select id from test_ids_ae where key = 'org'), 'Audit Test Rule', 'market', 'AUD', 'percentage', 25)
  returning id
)
insert into test_ids_ae (key, id) select 'rule', id from pr;

with cp1 as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate, margin_amount, final_amount, currency, status)
  values ((select id from test_ids_ae where key = 'rule'), (select id from test_ids_ae where key = 'sku'), 10, 'USD', 1.5, 3.75, 18.75, 'AUD', 'suggested')
  returning id
)
insert into test_ids_ae (key, id) select 'calc_approve', id from cp1;

select approve_suggested_price((select id from test_ids_ae where key = 'calc_approve'));
select ok(
  (select count(*) = 1 from audit_events where action = 'pricing.approve' and entity_id = (select id from test_ids_ae where key = 'calc_approve')),
  'approve_suggested_price() writes one audit_events row'
);

with cp2 as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate, margin_amount, final_amount, currency, status)
  values ((select id from test_ids_ae where key = 'rule'), (select id from test_ids_ae where key = 'sku'), 20, 'USD', 1.5, 7.5, 37.5, 'AUD', 'suggested')
  returning id
)
insert into test_ids_ae (key, id) select 'calc_override', id from cp2;

select override_suggested_price((select id from test_ids_ae where key = 'calc_override'), 30.00);
select ok(
  (select count(*) = 1 from audit_events where action = 'pricing.override' and entity_id = (select id from test_ids_ae where key = 'calc_override')),
  'override_suggested_price() writes one audit_events row'
);

with cp3 as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate, margin_amount, final_amount, currency, status)
  values ((select id from test_ids_ae where key = 'rule'), (select id from test_ids_ae where key = 'sku'), 5, 'USD', 1.5, 1.25, 6.25, 'AUD', 'suggested')
  returning id
)
insert into test_ids_ae (key, id) select 'calc_reject', id from cp3;

select reject_suggested_price((select id from test_ids_ae where key = 'calc_reject'));
select ok(
  (select count(*) = 1 from audit_events where action = 'pricing.reject' and entity_id = (select id from test_ids_ae where key = 'calc_reject')),
  'reject_suggested_price() writes one audit_events row'
);

select publish_suggested_price((select id from test_ids_ae where key = 'calc_approve'));
with pp as (select id from published_prices where calculated_price_id = (select id from test_ids_ae where key = 'calc_approve'))
insert into test_ids_ae (key, id) select 'published', id from pp;
select ok(
  (select count(*) = 1 from audit_events where action = 'pricing.publish' and entity_id = (select id from test_ids_ae where key = 'published')),
  'publish_suggested_price() writes one audit_events row'
);

select set_price_override((select id from test_ids_ae where key = 'published'), (select id from test_ids_ae where key = 'source'), 15.00, 'clearance');
select ok(
  (select count(*) = 1 from audit_events where action = 'pricing.set_override'),
  'set_price_override() writes one audit_events row'
);

select clear_price_override((select id from test_ids_ae where key = 'published'), (select id from test_ids_ae where key = 'source'));
select ok(
  (select count(*) = 1 from audit_events where action = 'pricing.clear_override'),
  'clear_price_override() writes one audit_events row'
);

reset role;

select finish();

rollback;
