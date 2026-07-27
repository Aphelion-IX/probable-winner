-- pgTAP tests for the restock/price alert notification trigger (backlog
-- B-192): a customer's price_alerts/restock_alerts row (migration
-- 20260724130000) previously sat at status='active' forever -- nothing
-- ever enqueued a check against it. This migration
-- (20260727020000_enqueue_restock_and_price_alert_checks.sql) wires
-- emit_integration_event() and publish_suggested_price() to enqueue a
-- restock_alerts pgmq message; the worker-side check/email logic is
-- covered by apps/worker/src/jobs/notify-alert-subscribers.test.ts and
-- apps/worker/src/consumers/restock-alerts-consumer.test.ts.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Wrapped in BEGIN/ROLLBACK so no fixture data is left behind.
begin;

select plan(4);

create temp table test_ids_rpa (key text primary key, id uuid);
grant select, insert on test_ids_rpa to authenticated;

insert into test_ids_rpa (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_rpa where key = 'org'), 'RPA Test Store', 'rpatest', 'store'
  returning id
)
insert into test_ids_rpa (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'rpatst', 'RPA Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001901', 'RPA Test Card', 'Instant' from g
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
insert into test_ids_rpa (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpa-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_rpa where key = 'org'), '00000000-0000-0000-0000-000000001902', 'system_admin', 'all_stores';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001902', true);
set local role authenticated;

-- Test 1/2: an inventory change enqueues a restock_alerts check-message
-- carrying the affected sku (via emit_integration_event()'s existing
-- inventory_balance_changed path -- no changes to receive_inventory itself).
select receive_inventory((select id from test_ids_rpa where key = 'node'), (select id from test_ids_rpa where key = 'sku'), 5, 'test', null, 'seed');

reset role;

select ok(
  (
    select count(*) = 1 from pgmq.q_restock_alerts
    where message ->> 'checkType' = 'restock'
      and (message ->> 'sellableSkuId')::uuid = (select id from test_ids_rpa where key = 'sku')
  ),
  'receive_inventory() enqueues exactly one restock_alerts restock-check message for the affected sku'
);

select ok(
  (
    -- Same integration_events row the search_index message already
    -- references (verified by integration_events_outbox.test.sql) -- this
    -- is an additional consumer of the same event, not a separate write.
    select count(*) = 1 from pgmq.q_restock_alerts rpa
    where (rpa.message ->> 'integrationEventId')::uuid = (
      select id from integration_events
      where event_type = 'inventory_balance_changed'
        and (payload ->> 'sellableSkuId')::uuid = (select id from test_ids_rpa where key = 'sku')
    )
  ),
  'the restock-check message references the same integration_event as the search_index message'
);

set local role authenticated;

-- Test 3/4: publishing a price enqueues a restock_alerts price-check
-- message (publish_suggested_price() does not route through
-- emit_integration_event(), so it needs its own explicit enqueue call).
with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_rpa where key = 'org'), 'RPA Test Rule', 'market', 'AUD', 'percentage', 30
  returning id
)
insert into test_ids_rpa (key, id) select 'rule', id from pr;

with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_rpa where key = 'rule'), (select id from test_ids_rpa where key = 'sku'),
    10, 'USD', 1.55, 4.65, 20.15, 'AUD', 'approved'
  returning id
)
insert into test_ids_rpa (key, id) select 'calc', id from cp;

select publish_suggested_price((select id from test_ids_rpa where key = 'calc'));

reset role;

select ok(
  (
    select count(*) = 1 from pgmq.q_restock_alerts
    where message ->> 'checkType' = 'price'
      and (message ->> 'sellableSkuId')::uuid = (select id from test_ids_rpa where key = 'sku')
      and (message ->> 'finalAmount')::numeric = 20.15
      and message ->> 'currency' = 'AUD'
  ),
  'publish_suggested_price() enqueues exactly one restock_alerts price-check message'
);

select ok(
  (
    -- publish_suggested_price()'s pre-existing raw integration_events
    -- insert (not routed through emit_integration_event()) is untouched by
    -- this migration -- it still writes exactly one pricing_published row.
    select count(*) = 1 from integration_events
    where event_type = 'pricing_published'
      and (payload ->> 'sellable_sku_id')::uuid = (select id from test_ids_rpa where key = 'sku')
  ),
  'publish_suggested_price() still writes its existing pricing_published integration_events row unchanged'
);

select finish();

rollback;
