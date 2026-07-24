-- pgTAP tests for get_cart_contents() (backlog B-110/B-111's storefront cart
-- page). Core ACs: a guest can read their own cart's contents by guest_token
-- (raw table RLS blocks this, see 20260723070153_carts.sql's comment, so the
-- function is the only read path), an authenticated customer can read their
-- own cart via auth.uid() with no token, an unrelated/unknown guest_token
-- returns an empty set rather than an error, and calling with neither a
-- token nor an authenticated session is rejected.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(5);

create temp table test_ids_gcc (key text primary key, id uuid);
grant select, insert on test_ids_gcc to authenticated, anon;

insert into test_ids_gcc (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_gcc where key = 'org'), 'GCC Test Store', 'gcctest', 'store'
  returning id
)
insert into test_ids_gcc (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'gcctst', 'GCC Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001401', 'GCC Test Card', 'Instant' from g
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
insert into test_ids_gcc (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gcc-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_gcc where key = 'org'), '00000000-0000-0000-0000-000000001402', 'inventory_manager', 'store', (select id from test_ids_gcc where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001402', true);
set local role authenticated;
select receive_inventory((select id from test_ids_gcc where key = 'node'), (select id from test_ids_gcc where key = 'sku'), 10, 'test', null, 'seed');
reset role;

-- Guest cart with one line.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_gcc where key = 'org'), null, '00000000-0000-0000-0000-00000000c101'::uuid) as cart
)
insert into test_ids_gcc (key, id) select 'guest_cart', (cart).id from c;

select add_to_cart(
  (select id from test_ids_gcc where key = 'guest_cart'),
  (select id from test_ids_gcc where key = 'node'),
  (select id from test_ids_gcc where key = 'sku'),
  2
);
reset role;

set local role anon;
select ok(
  (
    select count(*) = 1
       and (array_agg(card_name))[1] = 'GCC Test Card'
       and (array_agg(set_code))[1] = 'gcctst'
       and (array_agg(quantity))[1] = 2
       and (array_agg(price))[1] is null
       and (array_agg(reservation_expires_at))[1] is not null
    from get_cart_contents('00000000-0000-0000-0000-00000000c101'::uuid)
  ),
  'get_cart_contents(guest_token) returns the guest cart''s one line with joined card/price/reservation details'
);

select ok(
  (select count(*) = 0 from get_cart_contents('00000000-0000-0000-0000-00000000dead'::uuid)),
  'an unknown/unrelated guest_token returns an empty set, not an error'
);
reset role;

select throws_ok(
  $$select * from get_cart_contents(null)$$,
  null,
  'get_cart_contents: must provide guest_token or be authenticated',
  'calling with no guest_token while unauthenticated is rejected'
);

-- Authenticated customer with their own populated cart.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gcc-customer@test.local');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001403', true);
set local role authenticated;

with c as (
  select get_or_create_cart((select id from test_ids_gcc where key = 'org'), '00000000-0000-0000-0000-000000001403'::uuid, null) as cart
)
insert into test_ids_gcc (key, id) select 'customer_cart', (cart).id from c;

select add_to_cart(
  (select id from test_ids_gcc where key = 'customer_cart'),
  (select id from test_ids_gcc where key = 'node'),
  (select id from test_ids_gcc where key = 'sku'),
  1
);

select ok(
  (select count(*) = 1 and (array_agg(quantity))[1] = 1 from get_cart_contents()),
  'get_cart_contents() with no guest_token uses auth.uid() to find the authenticated customer''s own cart'
);
reset role;

select finish();

rollback;
