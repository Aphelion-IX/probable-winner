-- pgTAP tests for cart functions (backlog B-110/B-111). Core AC: merging
-- a guest cart into a customer cart on login produces the union of lines
-- with correct quantities and no duplicates.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(12);

create temp table test_ids_cart (key text primary key, id uuid);
grant select, insert on test_ids_cart to authenticated, anon;

insert into test_ids_cart (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_cart where key = 'org'), 'Cart Test Store', 'carttest', 'store'
  returning id
)
insert into test_ids_cart (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'crttst', 'Cart Test Set' from g
       returning id
     ),
     oc_a as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001301', 'Cart Test Card A', 'Instant' from g
       returning id
     ),
     oc_b as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001302', 'Cart Test Card B', 'Instant' from g
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
insert into test_ids_cart (key, id)
select 'sku_a', id from sku_a
union all
select 'sku_b', id from sku_b;

-- Seed stock as staff.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001303', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cart-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_cart where key = 'org'), '00000000-0000-0000-0000-000000001303', 'inventory_manager', 'store', (select id from test_ids_cart where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001303', true);
set local role authenticated;
select receive_inventory((select id from test_ids_cart where key = 'node'), (select id from test_ids_cart where key = 'sku_a'), 10, 'test', null, 'seed A');
select receive_inventory((select id from test_ids_cart where key = 'node'), (select id from test_ids_cart where key = 'sku_b'), 10, 'test', null, 'seed B');
reset role;

-- Guest cart flow.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_cart where key = 'org'), null, '00000000-0000-0000-0000-00000000c001'::uuid) as cart
)
insert into test_ids_cart (key, id) select 'guest_cart', (cart).id from c;

select ok(
  (select get_or_create_cart((select id from test_ids_cart where key = 'org'), null, '00000000-0000-0000-0000-00000000c001'::uuid)).id = (select id from test_ids_cart where key = 'guest_cart'),
  'calling get_or_create_cart again with the same guest_token returns the same cart'
);
reset role;

-- carts has no anon SELECT policy (see the schema migration's comment) --
-- reading it back to check field values needs the elevated role, unlike
-- the check above, which only reads the function's own return value.
select ok(
  (select customer_id is null and guest_token = '00000000-0000-0000-0000-00000000c001'::uuid and status = 'active' from carts where id = (select id from test_ids_cart where key = 'guest_cart')),
  'get_or_create_cart creates a guest cart for a new guest_token'
);

set local role anon;
with l as (
  select add_to_cart(
    (select id from test_ids_cart where key = 'guest_cart'),
    (select id from test_ids_cart where key = 'node'),
    (select id from test_ids_cart where key = 'sku_a'),
    2
  ) as line
)
insert into test_ids_cart (key, id) select 'guest_line_a', (line).id from l;

select add_to_cart(
  (select id from test_ids_cart where key = 'guest_cart'),
  (select id from test_ids_cart where key = 'node'),
  (select id from test_ids_cart where key = 'sku_b'),
  3
);
reset role;

select ok(
  (select count(*) = 2 from cart_lines where cart_id = (select id from test_ids_cart where key = 'guest_cart')),
  'the guest cart has two lines after adding two different SKUs'
);

set local role anon;
select add_to_cart(
  (select id from test_ids_cart where key = 'guest_cart'),
  (select id from test_ids_cart where key = 'node'),
  (select id from test_ids_cart where key = 'sku_a'),
  1
);
reset role;

select ok(
  (
    select count(*) = 1 and (select quantity from cart_lines where id = (select id from test_ids_cart where key = 'guest_line_a')) = 3
    from cart_lines
    where cart_id = (select id from test_ids_cart where key = 'guest_cart')
      and sellable_sku_id = (select id from test_ids_cart where key = 'sku_a')
  ),
  'adding more of an already-carted SKU combines into the existing line (2+1=3), not a duplicate row'
);

-- Customer cart, pre-populated with a colliding SKU (sku_a) at a
-- different quantity, and no line for sku_b.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001304', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cart-customer@test.local');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001304', true);
set local role authenticated;

with c as (
  select get_or_create_cart((select id from test_ids_cart where key = 'org'), '00000000-0000-0000-0000-000000001304'::uuid, null) as cart
)
insert into test_ids_cart (key, id) select 'customer_cart', (cart).id from c;

select add_to_cart(
  (select id from test_ids_cart where key = 'customer_cart'),
  (select id from test_ids_cart where key = 'node'),
  (select id from test_ids_cart where key = 'sku_a'),
  1
);

-- Merge: sku_a collides (3 guest + 1 customer = 4), sku_b has no collision.
with m as (
  select merge_guest_cart_into_customer_cart((select id from test_ids_cart where key = 'guest_cart'), '00000000-0000-0000-0000-000000001304'::uuid) as cart
)
select (cart).id from m;

-- Reset role before reading: the guest cart's customer_id is null, so
-- carts_select_own (customer_id = auth.uid()) wouldn't match it under the
-- still-active authenticated(customer) role from above, silently filtering
-- these reads via RLS rather than reflecting the true post-merge state.
reset role;

select ok(
  (select status = 'merged' from carts where id = (select id from test_ids_cart where key = 'guest_cart')),
  'the guest cart is marked merged after merging'
);
select ok(
  (select count(*) = 2 from cart_lines where cart_id = (select id from test_ids_cart where key = 'customer_cart')),
  'the customer cart has exactly 2 lines after merge -- the union, no duplicates (B-110 core AC)'
);
select ok(
  (select quantity = 4 from cart_lines where cart_id = (select id from test_ids_cart where key = 'customer_cart') and sellable_sku_id = (select id from test_ids_cart where key = 'sku_a')),
  'the colliding SKU line combines to the correct total quantity (3 guest + 1 customer = 4)'
);
select ok(
  (select quantity = 3 from cart_lines where cart_id = (select id from test_ids_cart where key = 'customer_cart') and sellable_sku_id = (select id from test_ids_cart where key = 'sku_b')),
  'the non-colliding SKU line is re-parented to the customer cart with its original quantity intact (no data loss)'
);
select ok(
  (select count(*) = 0 from cart_lines where cart_id = (select id from test_ids_cart where key = 'guest_cart')),
  'no lines remain under the old guest cart id after merge'
);

reset role;

-- update_cart_line_quantity to 0 removes the line and releases its reservation.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001304', true);
select update_cart_line_quantity(
  (select id from cart_lines where cart_id = (select id from test_ids_cart where key = 'customer_cart') and sellable_sku_id = (select id from test_ids_cart where key = 'sku_b')),
  0
);
reset role;

select ok(
  (select count(*) = 1 from cart_lines where cart_id = (select id from test_ids_cart where key = 'customer_cart')),
  'setting a line quantity to 0 removes it -- only the sku_a line remains'
);
select ok(
  (
    select quantity_reserved = 0
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_cart where key = 'node')
      and sellable_sku_id = (select id from test_ids_cart where key = 'sku_b')
  ),
  'removing the line via zero quantity released its reservation back to available'
);

-- Access control: a different authenticated customer cannot get_or_create
-- (or otherwise act on) a cart for a customer_id that is not their own.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001305', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cart-attacker@test.local');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001305', true);
set local role authenticated;
select throws_ok(
  format($$select get_or_create_cart('%s', '00000000-0000-0000-0000-000000001304', null)$$, (select id from test_ids_cart where key = 'org')),
  null,
  'get_or_create_cart: access denied',
  'a customer cannot get_or_create a cart for a different customer_id'
);
reset role;

select finish();

rollback;
