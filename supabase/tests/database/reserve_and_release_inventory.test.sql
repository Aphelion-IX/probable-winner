-- pgTAP tests for reserve_inventory()/release_inventory_reservation()
-- (backlog B-062) -- this is the core oversell-prevention proof required by
-- blueprint §7's "done" criteria: two reservations for the last unit of
-- stock must resolve to exactly one success.
--
-- Same caveat as receive_and_adjust_inventory.test.sql re: true concurrent
-- connections not being reproducible in one pgTAP script without embedding
-- database credentials in a committed file. What's actually proven here:
-- reserve_inventory() locks the balance row (SELECT ... FOR UPDATE via
-- lock_inventory_balance()) before touching it, and its balance update is a
-- relative UPDATE guarded by inventory_balances' own
-- quantity_available_online >= 0 check constraint -- so under real
-- concurrency, the second caller blocks on the lock until the first
-- transaction commits, then applies its own arithmetic against the
-- post-commit (now zero) availability and fails the check constraint. This
-- test exercises that exact code path sequentially: reserve the entire
-- available quantity, then attempt to reserve one more and confirm it's
-- rejected -- the same rejection a genuinely concurrent second caller would
-- hit after losing the lock race.
--
-- Note on role switching: inventory_balances/inventory_reservations are
-- staff-only for SELECT (migrations 20260723054635/20260723055728), so
-- `role anon` (used deliberately below, since reserve_inventory/
-- release_inventory_reservation must be callable by a guest cart) cannot
-- read them back afterward -- every assertion below runs `reset role`
-- first, after making the actual reserve/release call as anon.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(9);

create temp table test_ids_rr (key text primary key, id uuid);
grant select, insert on test_ids_rr to authenticated, anon;

insert into test_ids_rr (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_rr where key = 'org'), 'Reserve Test Store', 'rrtest', 'store'
  returning id
)
insert into test_ids_rr (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'rrtst', 'Reserve Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000c01', 'Reserve Test Card', 'Instant' from g
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
insert into test_ids_rr (key, id) select 'sku', id from sku;

-- Seed one unit of on-hand/available stock via receive_inventory, acting as
-- staff (reserve_inventory itself needs no staff access, but receiving does).
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rr-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_rr where key = 'org'), '00000000-0000-0000-0000-000000000c02', 'inventory_manager', 'store', (select id from test_ids_rr where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c02', true);
set local role authenticated;
select receive_inventory(
  (select id from test_ids_rr where key = 'node'),
  (select id from test_ids_rr where key = 'sku'),
  1, 'test', null, 'seed one unit'
);
reset role;

-- Reservations happen as an unauthenticated (guest cart) caller.
set local role anon;
with r as (
  select reserve_inventory(
    (select id from test_ids_rr where key = 'node'),
    (select id from test_ids_rr where key = 'sku'),
    1
  ) as res
)
insert into test_ids_rr (key, id) select 'reservation', (res).id from r;
reset role;

select ok(
  (select status = 'active' and quantity = 1 from inventory_reservations where id = (select id from test_ids_rr where key = 'reservation')),
  'reserve_inventory creates an active reservation for the requested quantity'
);
select ok(
  (
    select quantity_reserved = 1 and quantity_available_online = 0
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_rr where key = 'node')
      and sellable_sku_id = (select id from test_ids_rr where key = 'sku')
  ),
  'reserving the only unit moves it from available to reserved'
);

-- The oversell-prevention proof: a second reservation for the same (now
-- unavailable) unit is rejected.
set local role anon;
select throws_ok(
  format(
    $$select reserve_inventory('%s', '%s', 1)$$,
    (select id from test_ids_rr where key = 'node'),
    (select id from test_ids_rr where key = 'sku')
  ),
  '23514',
  null,
  'a second reservation for the last (already-reserved) unit is rejected -- exactly one reservation succeeds'
);
reset role;

select ok(
  (
    select count(*) = 1 from inventory_reservations
    where fulfilment_node_id = (select id from test_ids_rr where key = 'node')
      and sellable_sku_id = (select id from test_ids_rr where key = 'sku')
      and status = 'active'
  ),
  'only one active reservation exists after the rejected second attempt'
);

select ok(
  (
    select count(*) = 1 from inventory_movements
    where fulfilment_node_id = (select id from test_ids_rr where key = 'node')
      and sellable_sku_id = (select id from test_ids_rr where key = 'sku')
      and movement_type = 'reserve'
  ),
  'the rejected reservation attempt did not write a reserve movement (transaction rolled back)'
);

-- Releasing restores availability.
set local role anon;
select release_inventory_reservation((select id from test_ids_rr where key = 'reservation'));
reset role;

select ok(
  (select status = 'released' from inventory_reservations where id = (select id from test_ids_rr where key = 'reservation')),
  'release_inventory_reservation marks the reservation released'
);
select ok(
  (
    select quantity_reserved = 0 and quantity_available_online = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_rr where key = 'node')
      and sellable_sku_id = (select id from test_ids_rr where key = 'sku')
  ),
  'release_inventory_reservation restores the unit to available'
);

-- Releasing an already-released reservation is a no-op, not an error.
set local role anon;
select lives_ok(
  format($$select release_inventory_reservation('%s')$$, (select id from test_ids_rr where key = 'reservation')),
  'releasing an already-released reservation does not error'
);
reset role;

select ok(
  (
    select quantity_reserved = 0 and quantity_available_online = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_rr where key = 'node')
      and sellable_sku_id = (select id from test_ids_rr where key = 'sku')
  ),
  'double-releasing does not double-credit availability'
);

select finish();

rollback;
