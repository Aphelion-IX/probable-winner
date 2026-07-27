-- pgTAP tests for the cross-tenant defects fixed in
-- 20260727000000_fix_cross_tenant_price_and_collection_store_scoping.sql:
-- create_pending_order() priced a line using any organisation's active
-- published_price for the SKU (not necessarily the cart's own org), and
-- accepted any fulfilment_node_id as the click-and-collect store with no
-- check that it belongs to the cart's organisation, is active, or actually
-- offers click-and-collect.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(7);

create temp table test_ids_cts (key text primary key, id uuid);
grant select, insert on test_ids_cts to authenticated, anon, service_role;

-- Two separate retailers.
with org as (insert into organisations (name) values ('CTS Org A') returning id)
insert into test_ids_cts (key, id) select 'org_a', id from org;

with org as (insert into organisations (name) values ('CTS Org B') returning id)
insert into test_ids_cts (key, id) select 'org_b', id from org;

-- Org A's eligible collection store.
with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_click_collect, allows_online_fulfilment)
  select (select id from test_ids_cts where key = 'org_a'), 'CTS A Store', 'ctsa', 'store', true, true, true
  returning id
)
insert into test_ids_cts (key, id) select 'node_a', id from n;

-- Org A's own store, but not eligible for collection (e.g. warehouse-like: no click-and-collect).
with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_click_collect, allows_online_fulfilment)
  select (select id from test_ids_cts where key = 'org_a'), 'CTS A No-Collect', 'ctsanc', 'warehouse', true, false, true
  returning id
)
insert into test_ids_cts (key, id) select 'node_a_no_collect', id from n;

-- Org A's own store, eligible for collection but inactive.
with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_click_collect, allows_online_fulfilment)
  select (select id from test_ids_cts where key = 'org_a'), 'CTS A Inactive', 'ctsai', 'store', false, true, true
  returning id
)
insert into test_ids_cts (key, id) select 'node_a_inactive', id from n;

-- Org B's store -- eligible for collection, but belongs to a different organisation entirely.
with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_click_collect, allows_online_fulfilment)
  select (select id from test_ids_cts where key = 'org_b'), 'CTS B Store', 'ctsb', 'store', true, true, true
  returning id
)
insert into test_ids_cts (key, id) select 'node_b', id from n;

-- One SKU shared across the whole (global, not per-org) catalogue.
with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'ctst', 'Cross Tenant Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001601', 'Cross Tenant Test Card', 'Instant' from g
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
insert into test_ids_cts (key, id) select 'sku', id from sku;

-- Org A and Org B each publish their OWN active price for the same shared
-- SKU -- this is exactly the scenario published_prices'
-- unique(sellable_sku_id, organisation_id, currency) constraint exists for.
with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_cts where key = 'org_a'), 'CTS A Rule', 'market', 'AUD', 'percentage', 0
  returning id
),
cp as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, final_amount, currency, status)
  select pr.id, (select id from test_ids_cts where key = 'sku'), 10, 'AUD', 10, 'AUD', 'approved'
  from pr
  returning pricing_rule_id, id
)
insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency)
select (select id from test_ids_cts where key = 'org_a'), cp.pricing_rule_id, (select id from test_ids_cts where key = 'sku'), cp.id, 10, 'AUD'
from cp;

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_cts where key = 'org_b'), 'CTS B Rule', 'market', 'AUD', 'percentage', 0
  returning id
),
cp as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, final_amount, currency, status)
  select pr.id, (select id from test_ids_cts where key = 'sku'), 999, 'AUD', 999, 'AUD', 'approved'
  from pr
  returning pricing_rule_id, id
)
insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency)
select (select id from test_ids_cts where key = 'org_b'), cp.pricing_rule_id, (select id from test_ids_cts where key = 'sku'), cp.id, 999, 'AUD'
from cp;

-- Seed stock at every node as staff.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cts-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_cts where key = 'org_a'), '00000000-0000-0000-0000-000000001602', 'inventory_manager', 'all_stores', null;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001602', true);
set local role authenticated;
select receive_inventory((select id from test_ids_cts where key = 'node_a'), (select id from test_ids_cts where key = 'sku'), 10, 'test', null, 'seed node_a');
select receive_inventory((select id from test_ids_cts where key = 'node_a_no_collect'), (select id from test_ids_cts where key = 'sku'), 10, 'test', null, 'seed node_a_no_collect');
reset role;

-- Cart 1: Org A guest, delivery order -- proves the price used is Org A's
-- own (10.00), never Org B's (999.00), despite both being active for this SKU.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_cts where key = 'org_a'), null, '00000000-0000-0000-0000-00000000f101'::uuid) as cart
)
insert into test_ids_cts (key, id) select 'cart1', (cart).id from c;

select add_to_cart(
  (select id from test_ids_cts where key = 'cart1'),
  (select id from test_ids_cts where key = 'node_a'),
  (select id from test_ids_cts where key = 'sku'),
  1,
  '00000000-0000-0000-0000-00000000f101'::uuid
);
reset role;

with result as (
  select create_pending_order(
    (select id from test_ids_cts where key = 'cart1'),
    null,
    '00000000-0000-0000-0000-00000000f101'::uuid,
    'online_shipping',
    '{"line1":"1 Test St","suburb":"Melbourne","state":"VIC","postcode":"3000"}'::jsonb,
    null
  ) as r
)
insert into test_ids_cts (key, id) select 'order1', (r->>'order_id')::uuid from result;

select ok(
  (
    select unit_price = 10.00
    from order_lines where order_id = (select id from test_ids_cts where key = 'order1')
  ),
  'create_pending_order prices the line using the cart''s own organisation''s published price (10.00), not another organisation''s (999.00)'
);

-- Cart 2: Org A guest, click-and-collect -- used across the next four
-- assertions to prove the collection-store validation.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_cts where key = 'org_a'), null, '00000000-0000-0000-0000-00000000f102'::uuid) as cart
)
insert into test_ids_cts (key, id) select 'cart2', (cart).id from c;

select add_to_cart(
  (select id from test_ids_cts where key = 'cart2'),
  (select id from test_ids_cts where key = 'node_a'),
  (select id from test_ids_cts where key = 'sku'),
  1,
  '00000000-0000-0000-0000-00000000f102'::uuid
);
reset role;

-- A different organisation's store must be refused, even though it is
-- itself active and click-and-collect-eligible.
select throws_ok(
  format(
    $$select create_pending_order('%s', null, '00000000-0000-0000-0000-00000000f102'::uuid, 'click_and_collect', null, '%s')$$,
    (select id from test_ids_cts where key = 'cart2'),
    (select id from test_ids_cts where key = 'node_b')
  ),
  null,
  format('create_pending_order: %s is not a valid click-and-collect store for this cart''s organisation', (select id from test_ids_cts where key = 'node_b')),
  'create_pending_order refuses a collection store belonging to a different organisation'
);

-- An inactive store in the cart's own organisation must be refused.
select throws_ok(
  format(
    $$select create_pending_order('%s', null, '00000000-0000-0000-0000-00000000f102'::uuid, 'click_and_collect', null, '%s')$$,
    (select id from test_ids_cts where key = 'cart2'),
    (select id from test_ids_cts where key = 'node_a_inactive')
  ),
  null,
  format('create_pending_order: %s is not a valid click-and-collect store for this cart''s organisation', (select id from test_ids_cts where key = 'node_a_inactive')),
  'create_pending_order refuses an inactive collection store'
);

-- A store in the cart's own organisation that doesn't offer
-- click-and-collect at all must be refused.
select throws_ok(
  format(
    $$select create_pending_order('%s', null, '00000000-0000-0000-0000-00000000f102'::uuid, 'click_and_collect', null, '%s')$$,
    (select id from test_ids_cts where key = 'cart2'),
    (select id from test_ids_cts where key = 'node_a_no_collect')
  ),
  null,
  format('create_pending_order: %s is not a valid click-and-collect store for this cart''s organisation', (select id from test_ids_cts where key = 'node_a_no_collect')),
  'create_pending_order refuses a store that does not offer click-and-collect'
);

-- The cart survives every rejected attempt (each one rolled back
-- entirely) -- proving these are real validation failures, not partial
-- writes.
select ok(
  (select status = 'active' from carts where id = (select id from test_ids_cts where key = 'cart2')),
  'cart2 remains active after three rejected collection-store attempts'
);

-- A genuinely valid collection store (own organisation, active, offers
-- click-and-collect) still succeeds.
with result as (
  select create_pending_order(
    (select id from test_ids_cts where key = 'cart2'),
    null,
    '00000000-0000-0000-0000-00000000f102'::uuid,
    'click_and_collect',
    null,
    (select id from test_ids_cts where key = 'node_a')
  ) as r
)
insert into test_ids_cts (key, id) select 'order2', (r->>'order_id')::uuid from result;

select ok(
  (
    select collection_store_id = (select id from test_ids_cts where key = 'node_a')
    from orders where id = (select id from test_ids_cts where key = 'order2')
  ),
  'a genuinely valid collection store (own org, active, click-and-collect-enabled) still succeeds'
);
select ok(
  (select status = 'converted' from carts where id = (select id from test_ids_cts where key = 'cart2')),
  'cart2 converts once a valid collection store is used'
);

select finish();

rollback;
