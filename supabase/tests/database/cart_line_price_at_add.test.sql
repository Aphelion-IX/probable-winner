-- pgTAP tests for cart price-drift detection (backlog B-113). Core ACs:
-- add_to_cart() snapshots the sku's current active published price into
-- the new price_at_add/currency_at_add columns (migration
-- 20260727050000_cart_line_price_at_add.sql) when a line is first created;
-- adding more of an already-present line (a quantity bump, not a new add)
-- leaves that snapshot untouched even if the price has since moved; and
-- get_cart_contents() surfaces both the snapshot and the live price so the
-- cart view can detect drift. The web-side priceChanged derivation is
-- covered by apps/web/src/features/cart/queries/get-cart-contents.test.ts.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Wrapped in BEGIN/ROLLBACK so no fixture data is left behind.
begin;

select plan(5);

create temp table test_ids_cpa (key text primary key, id uuid);
grant select, insert on test_ids_cpa to authenticated, anon;

insert into test_ids_cpa (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_cpa where key = 'org'), 'CPA Test Store', 'cpatest', 'store'
  returning id
)
insert into test_ids_cpa (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'cpatst', 'CPA Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000002001', 'CPA Test Card', 'Instant' from g
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
insert into test_ids_cpa (key, id) select 'sku', id from sku;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cpa-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_cpa where key = 'org'), '00000000-0000-0000-0000-000000002002', 'system_admin', 'all_stores';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002002', true);
set local role authenticated;

select receive_inventory((select id from test_ids_cpa where key = 'node'), (select id from test_ids_cpa where key = 'sku'), 10, 'test', null, 'seed');

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_cpa where key = 'org'), 'CPA Test Rule', 'market', 'AUD', 'percentage', 30
  returning id
)
insert into test_ids_cpa (key, id) select 'rule', id from pr;

with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_cpa where key = 'rule'), (select id from test_ids_cpa where key = 'sku'),
    10, 'USD', 1.55, 4.65, 15.00, 'AUD', 'approved'
  returning id
)
insert into test_ids_cpa (key, id) select 'calc_first', id from cp;

select publish_suggested_price((select id from test_ids_cpa where key = 'calc_first'));

reset role;

-- Test 1: a fresh cart line snapshots the current published price.
set local role anon;
with c as (
  select get_or_create_cart((select id from test_ids_cpa where key = 'org'), null, '00000000-0000-0000-0000-00000000c201'::uuid) as cart
)
insert into test_ids_cpa (key, id) select 'cart', (cart).id from c;

with line as (
  select add_to_cart(
    (select id from test_ids_cpa where key = 'cart'),
    (select id from test_ids_cpa where key = 'node'),
    (select id from test_ids_cpa where key = 'sku'),
    1,
    '00000000-0000-0000-0000-00000000c201'::uuid
  ) as l
)
insert into test_ids_cpa (key, id) select 'line', (l).id from line;

select ok(
  (
    select price_at_add = 15.00 and currency_at_add = 'AUD'
    from cart_lines where id = (select id from test_ids_cpa where key = 'line')
  ),
  'add_to_cart() snapshots the current published price into price_at_add/currency_at_add on a new line'
);
reset role;

-- Test 2: get_cart_contents() surfaces both the live price and the
-- snapshot, still matching (no drift yet).
set local role anon;
select ok(
  (
    select (array_agg(price))[1] = 15.00 and (array_agg(price_at_add))[1] = 15.00
    from get_cart_contents('00000000-0000-0000-0000-00000000c201'::uuid)
  ),
  'get_cart_contents() returns matching price and price_at_add before any price change'
);
reset role;

-- Publish a new (higher) price for the same sku -- simulates the drift a
-- customer should be warned about.
set local role authenticated;
with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_cpa where key = 'rule'), (select id from test_ids_cpa where key = 'sku'),
    12, 'USD', 1.55, 5.58, 20.00, 'AUD', 'approved'
  returning id
)
insert into test_ids_cpa (key, id) select 'calc_second', id from cp;

select publish_suggested_price((select id from test_ids_cpa where key = 'calc_second'));
reset role;

-- Test 3: get_cart_contents() now shows the live price diverging from the
-- untouched snapshot -- this is the drift the cart view's banner reacts to.
set local role anon;
select ok(
  (
    select (array_agg(price))[1] = 20.00 and (array_agg(price_at_add))[1] = 15.00
    from get_cart_contents('00000000-0000-0000-0000-00000000c201'::uuid)
  ),
  'get_cart_contents() reflects the new live price while price_at_add still holds the original snapshot'
);

-- Test 4: adding more of the same line (a quantity bump, not a new add)
-- does not overwrite the original snapshot with the now-current price.
select add_to_cart(
  (select id from test_ids_cpa where key = 'cart'),
  (select id from test_ids_cpa where key = 'node'),
  (select id from test_ids_cpa where key = 'sku'),
  1,
  '00000000-0000-0000-0000-00000000c201'::uuid
);
reset role;

select ok(
  (
    select quantity = 2 and price_at_add = 15.00
    from cart_lines where id = (select id from test_ids_cpa where key = 'line')
  ),
  'bumping the quantity of an existing line leaves its original price_at_add snapshot unchanged'
);

-- Test 5: a line added when the sku has no active published price gets a
-- null snapshot, not a spurious value -- get_cart_contents() must not
-- report a false "price changed" for it (price is also null, so the web
-- layer's priceChanged only fires when both sides are non-null).
with cp2 as (
  insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
  select oracle_card_id, set_id, '2', 'common', array['nonfoil']
  from card_printings where id = (
    select card_printing_id from sellable_skus where id = (select id from test_ids_cpa where key = 'sku')
  )
  returning id
),
sku2 as (
  insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
  select cp2.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
  from cp2 returning id
)
insert into test_ids_cpa (key, id) select 'sku_no_price', id from sku2;

set local role authenticated;
select receive_inventory((select id from test_ids_cpa where key = 'node'), (select id from test_ids_cpa where key = 'sku_no_price'), 5, 'test', null, 'seed');
reset role;

set local role anon;
select add_to_cart(
  (select id from test_ids_cpa where key = 'cart'),
  (select id from test_ids_cpa where key = 'node'),
  (select id from test_ids_cpa where key = 'sku_no_price'),
  1,
  '00000000-0000-0000-0000-00000000c201'::uuid
);

select ok(
  (
    select price_at_add is null
    from cart_lines
    where cart_id = (select id from test_ids_cpa where key = 'cart')
      and sellable_sku_id = (select id from test_ids_cpa where key = 'sku_no_price')
  ),
  'a line added for a sku with no active published price gets a null price_at_add snapshot'
);
reset role;

select finish();

rollback;
