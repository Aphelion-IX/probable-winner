-- pgTAP tests for create_pending_order() (2026-07-26 security re-audit
-- items 3/5/6/8) and the reservation-matching fix in
-- confirm_order_payment()/release_failed_order_reservations() (item 4).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(13);

create temp table test_ids_apo (key text primary key, id uuid);
grant select, insert on test_ids_apo to authenticated, anon, service_role;

insert into test_ids_apo (key, id) select 'org', id from organisations limit 1;

with na as (
  insert into fulfilment_nodes (organisation_id, name, code, type, allows_online_fulfilment, allows_click_collect)
  select (select id from test_ids_apo where key = 'org'), 'APO Store A', 'apotesta', 'store', true, true
  returning id
)
insert into test_ids_apo (key, id) select 'node_a', id from na;

with nb as (
  insert into fulfilment_nodes (organisation_id, name, code, type, allows_online_fulfilment, allows_click_collect)
  select (select id from test_ids_apo where key = 'org'), 'APO Store B', 'apotestb', 'store', true, true
  returning id
)
insert into test_ids_apo (key, id) select 'node_b', id from nb;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'apotst', 'APO Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001501', 'APO Test Card', 'Instant' from g
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
insert into test_ids_apo (key, id) select 'sku', id from sku;

-- Price the SKU (published_prices requires a pricing_rule + calculated_price).
with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_apo where key = 'org'), 'APO Test Rule', 'market', 'AUD', 'percentage', 30
  returning id
),
cp as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, final_amount, currency, status)
  select pr.id, (select id from test_ids_apo where key = 'sku'), 10, 'AUD', 10, 'AUD', 'approved'
  from pr
  returning pricing_rule_id, id
)
insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency)
select (select id from test_ids_apo where key = 'org'), cp.pricing_rule_id, (select id from test_ids_apo where key = 'sku'), cp.id, 10, 'AUD'
from cp;

-- Seed stock at both stores as staff.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apo-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_apo where key = 'org'), '00000000-0000-0000-0000-000000001502', 'inventory_manager', 'all_stores', null;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001502', true);
set local role authenticated;
select receive_inventory((select id from test_ids_apo where key = 'node_a'), (select id from test_ids_apo where key = 'sku'), 10, 'test', null, 'seed A');
select receive_inventory((select id from test_ids_apo where key = 'node_b'), (select id from test_ids_apo where key = 'sku'), 1, 'test', null, 'seed B (only 1 unit)');
reset role;

-- A guest cart with one line, reserved (by default) at node_a.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_apo where key = 'org'), null, '00000000-0000-0000-0000-00000000e001'::uuid) as cart
)
insert into test_ids_apo (key, id) select 'cart', (cart).id from c;

with l as (
  select add_to_cart(
    (select id from test_ids_apo where key = 'cart'),
    (select id from test_ids_apo where key = 'node_a'),
    (select id from test_ids_apo where key = 'sku'),
    1,
    '00000000-0000-0000-0000-00000000e001'::uuid
  ) as line
)
insert into test_ids_apo (key, id) select 'cart_line', (line).id from l;
reset role;

insert into test_ids_apo (key, id)
select 'original_reservation', inventory_reservation_id from cart_lines where id = (select id from test_ids_apo where key = 'cart_line');

-- IDOR: create_pending_order refuses a caller without the guest cart's token.
select throws_ok(
  format(
    $$select create_pending_order('%s', null, '00000000-0000-0000-0000-00000000dead'::uuid, 'online_shipping', '{"line1":"1 Test St","suburb":"Melbourne","state":"VIC","postcode":"3000"}'::jsonb, null)$$,
    (select id from test_ids_apo where key = 'cart')
  ),
  null,
  format('create_pending_order: access denied for cart %s', (select id from test_ids_apo where key = 'cart')),
  'create_pending_order refuses a guest cart without its matching guest_token'
);

-- Click-and-collect at node_b (different from the line's actual reservation
-- node, node_a): the audit's core fix -- the allocation must be backed by
-- real stock at node_b, not a copy-paste of node_a's reservation.
with result as (
  select create_pending_order(
    (select id from test_ids_apo where key = 'cart'),
    null,
    '00000000-0000-0000-0000-00000000e001'::uuid,
    'click_and_collect',
    null,
    (select id from test_ids_apo where key = 'node_b')
  ) as r
)
insert into test_ids_apo (key, id) select 'order', (r->>'order_id')::uuid from result;

select ok(
  (select status = 'converted' from carts where id = (select id from test_ids_apo where key = 'cart')),
  'create_pending_order marks the source cart converted'
);
select ok(
  (select fulfilment_type = 'click_and_collect' and collection_store_id = (select id from test_ids_apo where key = 'node_b') and total_amount = 10 and status = 'pending'
   from orders where id = (select id from test_ids_apo where key = 'order')),
  'the order is created pending, at the chosen collection store, with the correct total'
);
select ok(
  (
    select oa.allocated_to_node_id = (select id from test_ids_apo where key = 'node_b')
    from order_allocations oa
    join order_lines ol on ol.id = oa.order_line_id
    where ol.order_id = (select id from test_ids_apo where key = 'order')
  ),
  'the order line is allocated to node_b (the actual collection store), not node_a (where the cart originally reserved)'
);
select ok(
  (
    select ol.inventory_reservation_id is not null and ol.inventory_reservation_id <> (select id from test_ids_apo where key = 'original_reservation')
    from order_lines ol
    where ol.order_id = (select id from test_ids_apo where key = 'order')
  ),
  'the order line is linked to a fresh reservation at node_b, not the original node_a reservation'
);
select ok(
  (select status = 'released' from inventory_reservations where id = (select id from test_ids_apo where key = 'original_reservation')),
  'the original node_a reservation was released, not left dangling'
);
select ok(
  (
    select quantity_reserved = 1
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_apo where key = 'node_b')
      and sellable_sku_id = (select id from test_ids_apo where key = 'sku')
  ),
  'node_b''s balance shows the unit actually reserved there, backing the allocation for real'
);

-- Atomicity: click-and-collect at a store with no stock at all must roll
-- back the whole order, not leave a false allocation behind.
set local role anon;
with c2 as (
  select get_or_create_cart((select id from test_ids_apo where key = 'org'), null, '00000000-0000-0000-0000-00000000e002'::uuid) as cart
)
insert into test_ids_apo (key, id) select 'cart2', (cart).id from c2;

select add_to_cart(
  (select id from test_ids_apo where key = 'cart2'),
  (select id from test_ids_apo where key = 'node_a'),
  (select id from test_ids_apo where key = 'sku'),
  5,
  '00000000-0000-0000-0000-00000000e002'::uuid
);
reset role;

select throws_ok(
  format(
    $$select create_pending_order('%s', null, '00000000-0000-0000-0000-00000000e002'::uuid, 'click_and_collect', null, '%s')$$,
    (select id from test_ids_apo where key = 'cart2'),
    (select id from test_ids_apo where key = 'node_b')
  ),
  '23514',
  'create_pending_order rejects click-and-collect when the chosen store lacks the stock (no false allocation)'
);
select ok(
  (select status = 'active' from carts where id = (select id from test_ids_apo where key = 'cart2')),
  'the failed checkout leaves the cart active (whole transaction rolled back)'
);
select ok(
  (
    select status = 'active' and quantity = 5
    from inventory_reservations ir
    join cart_lines cl on cl.inventory_reservation_id = ir.id
    where cl.cart_id = (select id from test_ids_apo where key = 'cart2')
  ),
  'the original reservation is untouched after the rolled-back attempt'
);

-- confirm_order_payment: exact reservation matching, not "any cart with
-- this SKU" (the bug the audit's item 4 flagged). A second, unrelated
-- guest cart holding the very same SKU exists concurrently (cart2, above)
-- -- confirming payment on the click-and-collect order must convert *its*
-- reservation, never touch cart2's.
set local role service_role;
select confirm_order_payment((select id from test_ids_apo where key = 'order'), 'evt_apo_test_1');
reset role;

select ok(
  (select status = 'paid' from orders where id = (select id from test_ids_apo where key = 'order')),
  'confirm_order_payment marks the order paid'
);
select ok(
  (
    select ir.status = 'converted'
    from order_lines ol
    join inventory_reservations ir on ir.id = ol.inventory_reservation_id
    where ol.order_id = (select id from test_ids_apo where key = 'order')
  ),
  'confirm_order_payment converts exactly this order line''s own reservation'
);
select ok(
  (
    select ir.status = 'active' and ir.quantity = 5
    from inventory_reservations ir
    join cart_lines cl on cl.inventory_reservation_id = ir.id
    where cl.cart_id = (select id from test_ids_apo where key = 'cart2')
  ),
  'the unrelated cart2 reservation for the same SKU is untouched by confirm_order_payment'
);

select finish();

rollback;
