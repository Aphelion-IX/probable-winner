-- pgTAP tests for order confirmation emails (migration
-- 20260727060000_order_confirmation_email.sql). Core ACs: confirm_order_payment()
-- captures Stripe's own captured buyer email onto a guest order's new
-- guest_email column (since nothing in checkout itself collects one), never
-- does so for an authenticated customer's order (their real account email
-- is the only one ever used for that case -- see
-- apps/worker/src/jobs/send-order-confirmation-email.test.ts), and routes
-- its order_paid event through emit_integration_event() so an
-- order_confirmation message actually reaches the "email" pgmq queue
-- (previously dead since migration 20260722120349 -- nothing ever wrote to
-- it at all).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Wrapped in BEGIN/ROLLBACK so no fixture data is left behind.
begin;

select plan(4);

create temp table test_ids_oce (key text primary key, id uuid);
grant select, insert on test_ids_oce to authenticated, anon, service_role;

insert into test_ids_oce (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type, allows_online_fulfilment, allows_click_collect)
  select (select id from test_ids_oce where key = 'org'), 'OCE Test Store', 'ocetest', 'store', true, true
  returning id
)
insert into test_ids_oce (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'ocetst', 'OCE Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000002101', 'OCE Test Card', 'Instant' from g
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
insert into test_ids_oce (key, id) select 'sku', id from sku;

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_oce where key = 'org'), 'OCE Test Rule', 'market', 'AUD', 'percentage', 30
  returning id
),
cp as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, final_amount, currency, status)
  select pr.id, (select id from test_ids_oce where key = 'sku'), 10, 'AUD', 10, 'AUD', 'approved'
  from pr
  returning pricing_rule_id, id
)
insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency)
select (select id from test_ids_oce where key = 'org'), cp.pricing_rule_id, (select id from test_ids_oce where key = 'sku'), cp.id, 10, 'AUD'
from cp;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'oce-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_oce where key = 'org'), '00000000-0000-0000-0000-000000002102', 'inventory_manager', 'all_stores', null;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002102', true);
set local role authenticated;
select receive_inventory((select id from test_ids_oce where key = 'node'), (select id from test_ids_oce where key = 'sku'), 10, 'test', null, 'seed');
reset role;

-- A guest cart/order.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_oce where key = 'org'), null, '00000000-0000-0000-0000-00000000e101'::uuid) as cart
)
insert into test_ids_oce (key, id) select 'guest_cart', (cart).id from c;

select add_to_cart(
  (select id from test_ids_oce where key = 'guest_cart'),
  (select id from test_ids_oce where key = 'node'),
  (select id from test_ids_oce where key = 'sku'),
  1,
  '00000000-0000-0000-0000-00000000e101'::uuid
);

with result as (
  select create_pending_order(
    (select id from test_ids_oce where key = 'guest_cart'),
    null,
    '00000000-0000-0000-0000-00000000e101'::uuid,
    'online_shipping',
    '{"line1":"1 Test St","suburb":"Melbourne","state":"VIC","postcode":"3000"}'::jsonb,
    null
  ) as r
)
insert into test_ids_oce (key, id) select 'guest_order', (r->>'order_id')::uuid from result;
reset role;

-- Confirm payment for the guest order, passing Stripe's captured email.
set local role service_role;
select confirm_order_payment(
  (select id from test_ids_oce where key = 'guest_order'),
  'evt_oce_guest_1',
  'buyer@example.com'
);
reset role;

select ok(
  (
    select guest_email = 'buyer@example.com'
    from orders where id = (select id from test_ids_oce where key = 'guest_order')
  ),
  'confirm_order_payment() captures the Stripe-supplied email onto a guest order''s guest_email column'
);

select ok(
  (
    select count(*) = 1 from pgmq.q_email
    where message ->> 'emailType' = 'order_confirmation'
      and (message ->> 'orderId')::uuid = (select id from test_ids_oce where key = 'guest_order')
  ),
  'confirm_order_payment() enqueues exactly one order_confirmation message on the email queue'
);

-- An authenticated customer's order must never get a guest_email, even if
-- one happens to be passed (Stripe collects an email regardless of
-- sign-in state) -- the real account email is the only one ever used.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000002103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'oce-customer@test.local');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002103', true);
set local role authenticated;

with c as (
  select get_or_create_cart((select id from test_ids_oce where key = 'org'), '00000000-0000-0000-0000-000000002103'::uuid, null) as cart
)
insert into test_ids_oce (key, id) select 'customer_cart', (cart).id from c;

select add_to_cart(
  (select id from test_ids_oce where key = 'customer_cart'),
  (select id from test_ids_oce where key = 'node'),
  (select id from test_ids_oce where key = 'sku'),
  1
);

with result as (
  select create_pending_order(
    (select id from test_ids_oce where key = 'customer_cart'),
    '00000000-0000-0000-0000-000000002103'::uuid,
    null,
    'online_shipping',
    '{"line1":"1 Test St","suburb":"Melbourne","state":"VIC","postcode":"3000"}'::jsonb,
    null
  ) as r
)
insert into test_ids_oce (key, id) select 'customer_order', (r->>'order_id')::uuid from result;
reset role;

set local role service_role;
select confirm_order_payment(
  (select id from test_ids_oce where key = 'customer_order'),
  'evt_oce_customer_1',
  'should-be-ignored@example.com'
);
reset role;

select ok(
  (
    select guest_email is null
    from orders where id = (select id from test_ids_oce where key = 'customer_order')
  ),
  'confirm_order_payment() never sets guest_email on an authenticated customer''s order'
);

select ok(
  (
    select count(*) = 1 from pgmq.q_email
    where message ->> 'emailType' = 'order_confirmation'
      and (message ->> 'orderId')::uuid = (select id from test_ids_oce where key = 'customer_order')
  ),
  'confirm_order_payment() enqueues an order_confirmation message for an authenticated customer''s order too'
);

select finish();

rollback;
