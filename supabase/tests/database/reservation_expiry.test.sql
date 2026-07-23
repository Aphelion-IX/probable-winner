-- pgTAP tests for release_expired_reservations() (backlog B-112). Core AC:
-- an expired reservation's stock becomes available again after the job
-- runs, while a still-active (non-expired) reservation is untouched.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(5);

create temp table test_ids_exp (key text primary key, id uuid);
grant select, insert on test_ids_exp to authenticated, anon;

insert into test_ids_exp (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_exp where key = 'org'), 'Expiry Test Store', 'exptest', 'store'
  returning id
)
insert into test_ids_exp (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'exptst', 'Expiry Test Set' from g
       returning id
     ),
     oc_a as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001401', 'Expiry Test Card A', 'Instant' from g
       returning id
     ),
     oc_b as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001402', 'Expiry Test Card B', 'Instant' from g
       returning id
     ),
     cp_a as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc_a.id, s.id, '1', 'common', array['nonfoil'] from oc_a, s returning id
     ),
     cp_b as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc_b.id, s.id, '2', 'common', array['nonfoil'] from oc_b, s returning id
     ),
     sku_a as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select cp_a.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp_a returning id
     ),
     sku_b as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select cp_b.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp_b returning id
     )
insert into test_ids_exp (key, id)
select 'sku_a', id from sku_a
union all
select 'sku_b', id from sku_b;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exp-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_exp where key = 'org'), '00000000-0000-0000-0000-000000001403', 'inventory_manager', 'store', (select id from test_ids_exp where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001403', true);
set local role authenticated;
select receive_inventory((select id from test_ids_exp where key = 'node'), (select id from test_ids_exp where key = 'sku_a'), 5, 'test', null, 'seed A');
select receive_inventory((select id from test_ids_exp where key = 'node'), (select id from test_ids_exp where key = 'sku_b'), 5, 'test', null, 'seed B');
reset role;

-- One reservation already expired (15 minutes ago), one still active
-- (15 minutes from now).
set local role anon;
with r_expired as (
  select reserve_inventory(
    (select id from test_ids_exp where key = 'node'),
    (select id from test_ids_exp where key = 'sku_a'),
    2, null, now() - interval '15 minutes'
  ) as res
)
insert into test_ids_exp (key, id) select 'expired_reservation', (res).id from r_expired;

with r_active as (
  select reserve_inventory(
    (select id from test_ids_exp where key = 'node'),
    (select id from test_ids_exp where key = 'sku_b'),
    3, null, now() + interval '15 minutes'
  ) as res
)
insert into test_ids_exp (key, id) select 'active_reservation', (res).id from r_active;
reset role;

select ok(
  (
    select quantity_reserved = 2 and quantity_available_online = 3
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_exp where key = 'node')
      and sellable_sku_id = (select id from test_ids_exp where key = 'sku_a')
  ),
  'sku A: reserving 2 of 5 leaves 3 available, before expiry runs'
);

select ok(
  (select release_expired_reservations()) = 1,
  'release_expired_reservations processes exactly the one expired reservation'
);

select ok(
  (select status = 'released' from inventory_reservations where id = (select id from test_ids_exp where key = 'expired_reservation')),
  'the expired reservation is marked released'
);
select ok(
  (
    select quantity_reserved = 0 and quantity_available_online = 5
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_exp where key = 'node')
      and sellable_sku_id = (select id from test_ids_exp where key = 'sku_a')
  ),
  'sku A stock becomes available again after the job runs (B-112 core AC)'
);

select ok(
  (
    select status = 'active' and quantity_reserved = 3 and quantity_available_online = 2
    from inventory_reservations r
    join inventory_balances b
      on b.fulfilment_node_id = r.fulfilment_node_id and b.sellable_sku_id = r.sellable_sku_id
    where r.id = (select id from test_ids_exp where key = 'active_reservation')
  ),
  'the still-active (non-expired) reservation on sku B is untouched'
);

select finish();

rollback;
