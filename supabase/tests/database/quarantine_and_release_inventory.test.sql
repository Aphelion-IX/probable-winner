-- pgTAP tests for quarantine_inventory()/release_inventory_quarantine()
-- (backlog B-064) -- the core AC: a quarantined unit cannot be reserved
-- even though quantity_on_hand is nonzero.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(9);

create temp table test_ids_qi (key text primary key, id uuid);
grant select, insert on test_ids_qi to authenticated;

insert into test_ids_qi (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_qi where key = 'org'), 'Quarantine Test Store', 'qitest', 'store'
  returning id
)
insert into test_ids_qi (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'qitst', 'Quarantine Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000e01', 'Quarantine Test Card', 'Instant' from g
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
insert into test_ids_qi (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000000e02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qi-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_qi where key = 'org'), '00000000-0000-0000-0000-000000000e02', 'inventory_manager', 'store', (select id from test_ids_qi where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000e02', true);
set local role authenticated;

select receive_inventory(
  (select id from test_ids_qi where key = 'node'),
  (select id from test_ids_qi where key = 'sku'),
  2, 'test', null, 'seed two units'
);

with q as (
  select quarantine_inventory(
    (select id from test_ids_qi where key = 'node'),
    (select id from test_ids_qi where key = 'sku'),
    1, 'suspected miscut, pending authentication'
  ) as rec
)
insert into test_ids_qi (key, id) select 'quarantine', (rec).id from q;

select ok(
  (select status = 'quarantined' and quantity = 1 from quarantined_inventory where id = (select id from test_ids_qi where key = 'quarantine')),
  'quarantine_inventory creates a quarantined record for the requested quantity'
);
select ok(
  (
    select quantity_on_hand = 2 and quantity_quarantined = 1 and quantity_available_online = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_qi where key = 'node')
      and sellable_sku_id = (select id from test_ids_qi where key = 'sku')
  ),
  'quarantining moves the unit from available to quarantined without touching on-hand stock'
);

-- The core AC: the quarantined unit cannot be reserved, but the remaining
-- (non-quarantined) unit still can.
select lives_ok(
  format(
    $$select reserve_inventory('%s', '%s', 1)$$,
    (select id from test_ids_qi where key = 'node'),
    (select id from test_ids_qi where key = 'sku')
  ),
  'the one remaining non-quarantined unit can still be reserved'
);
select throws_ok(
  format(
    $$select reserve_inventory('%s', '%s', 1)$$,
    (select id from test_ids_qi where key = 'node'),
    (select id from test_ids_qi where key = 'sku')
  ),
  '23514',
  null,
  'the quarantined unit cannot be reserved even though quantity_on_hand is nonzero (B-064 core AC)'
);

-- Quarantining more than is currently available is rejected the same way.
select throws_ok(
  format(
    $$select quarantine_inventory('%s', '%s', 5, 'too many')$$,
    (select id from test_ids_qi where key = 'node'),
    (select id from test_ids_qi where key = 'sku')
  ),
  '23514',
  null,
  'quarantining more than the currently available quantity is rejected'
);

select release_inventory_quarantine((select id from test_ids_qi where key = 'quarantine'));

select ok(
  (select status = 'released' from quarantined_inventory where id = (select id from test_ids_qi where key = 'quarantine')),
  'release_inventory_quarantine marks the record released'
);
select ok(
  (
    select quantity_quarantined = 0 and quantity_available_online = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_qi where key = 'node')
      and sellable_sku_id = (select id from test_ids_qi where key = 'sku')
  ),
  'releasing restores the unit to available (1: the other unit is still reserved, this one is now free)'
);

-- Releasing an already-released record is a no-op, not an error.
select lives_ok(
  format($$select release_inventory_quarantine('%s')$$, (select id from test_ids_qi where key = 'quarantine')),
  'releasing an already-released quarantine record does not error'
);
select ok(
  (
    select quantity_quarantined = 0 and quantity_available_online = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_qi where key = 'node')
      and sellable_sku_id = (select id from test_ids_qi where key = 'sku')
  ),
  'double-releasing does not double-credit availability'
);

reset role;

select finish();

rollback;
