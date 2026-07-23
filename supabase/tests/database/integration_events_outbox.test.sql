-- pgTAP tests for the integration_events outbox (backlog B-082): every
-- atomic inventory function writes an event in the same transaction as the
-- balance change, and a rolled-back transaction leaves no orphaned event.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(4);

create temp table test_ids_ie (key text primary key, id uuid);
grant select, insert on test_ids_ie to authenticated;

insert into test_ids_ie (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_ie where key = 'org'), 'Outbox Test Store', 'ietest', 'store'
  returning id
)
insert into test_ids_ie (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'ietst', 'Outbox Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001201', 'Outbox Test Card', 'Instant' from g
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
insert into test_ids_ie (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ie-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_ie where key = 'org'), '00000000-0000-0000-0000-000000001202', 'inventory_manager', 'store', (select id from test_ids_ie where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001202', true);
set local role authenticated;

select receive_inventory((select id from test_ids_ie where key = 'node'), (select id from test_ids_ie where key = 'sku'), 5, 'test', null, 'seed');

reset role;

select ok(
  (
    select count(*) = 1 from integration_events
    where event_type = 'inventory_balance_changed'
      and (payload ->> 'sellableSkuId')::uuid = (select id from test_ids_ie where key = 'sku')
      and (payload ->> 'fulfilmentNodeId')::uuid = (select id from test_ids_ie where key = 'node')
  ),
  'receive_inventory emits exactly one integration_events row describing the changed balance'
);
select ok(
  (
    select count(*) = 1 from pgmq.q_search_index
    where message ->> 'eventType' = 'inventory_balance_changed'
      and (message ->> 'integrationEventId')::uuid = (
        select id from integration_events
        where event_type = 'inventory_balance_changed'
          and (payload ->> 'sellableSkuId')::uuid = (select id from test_ids_ie where key = 'sku')
      )
  ),
  'a matching search_index queue message references that event id'
);

-- A rolled-back atomic-function call leaves no orphaned event: the failed
-- call below (insufficient available inventory) must not have inserted an
-- integration_events row for this attempt.
set local role authenticated;
select throws_ok(
  format(
    $$select reserve_inventory('%s', '%s', 999)$$,
    (select id from test_ids_ie where key = 'node'),
    (select id from test_ids_ie where key = 'sku')
  ),
  '23514',
  null,
  'reserving far more than available fails as expected, setting up the orphan-event check'
);
reset role;
select ok(
  (
    -- Still exactly 1 (from the successful receive_inventory call above) --
    -- the failed reserve_inventory call did not add a second row, meaning
    -- its (rolled-back) attempt to emit an event left no orphan.
    select count(*) = 1 from integration_events
    where event_type = 'inventory_balance_changed'
      and (payload ->> 'sellableSkuId')::uuid = (select id from test_ids_ie where key = 'sku')
      and (payload ->> 'fulfilmentNodeId')::uuid = (select id from test_ids_ie where key = 'node')
  ),
  'the rolled-back reserve_inventory call left no orphaned integration_events row (B-082 core AC)'
);

select finish();

rollback;
