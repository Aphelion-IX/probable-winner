-- pgTAP tests for published prices and store overrides (backlog B-164).
-- Core AC: central price book with per-store overrides, not full duplication.
-- Integration test: override at one store doesn't affect others' calculated price.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(16);

create temp table test_ids_pp (key text primary key, id uuid);
grant select, insert on test_ids_pp to authenticated, anon;

insert into test_ids_pp (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_pp where key = 'org'), 'PP Test Store', 'pptest', 'store'
  returning id
)
insert into test_ids_pp (key, id) select 'node', id from n;

with other_org as (
  insert into organisations (name) values ('PP Other Test Org') returning id
),
n2 as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select other_org.id, 'PP Other Org Store', 'ppother', 'store'
  from other_org
  returning id
)
insert into test_ids_pp (key, id) select 'other_org_node', id from n2;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'pptst', 'PP Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001701', 'PP Test Card', 'Instant' from g
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
insert into test_ids_pp (key, id) select 'sku', id from sku;

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_pp where key = 'org'), 'PP Test Rule', 'market', 'AUD', 'percentage', 30
  returning id
)
insert into test_ids_pp (key, id) select 'rule', id from pr;

-- Create an approved calculated price (ready to publish).
with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_pp where key = 'rule'), (select id from test_ids_pp where key = 'sku'),
    10, 'USD', 1.55, 4.65, 20.15, 'AUD', 'approved'
  returning id
)
insert into test_ids_pp (key, id) select 'calc_price', id from cp;

-- Test 1: publish_suggested_price creates published_prices row with correct amount.
select ok(
  (
    with published as (
      select publish_suggested_price((select id from test_ids_pp where key = 'calc_price'))
    )
    select exists(
      select 1 from published_prices where final_amount = 20.15 and status = 'active'
    )
  ),
  'publish_suggested_price() creates active published_price'
);

with pp as (
  select id from published_prices where final_amount = 20.15 and status = 'active' limit 1
)
insert into test_ids_pp (key, id) select 'published', id from pp;

-- Test 2: publish_suggested_price emits pricing_published event.
select ok(
  exists(
    select 1 from integration_events
    where event_type = 'pricing_published'
  ),
  'publish_suggested_price() emits pricing_published integration event'
);

-- Test 3: Cannot publish a suggested price (only approved prices).
with new_calc as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_pp where key = 'rule'), (select id from test_ids_pp where key = 'sku'),
    12, 'USD', 1.55, 5.58, 24.18, 'AUD', 'suggested'
  returning id
)
insert into test_ids_pp (key, id) select 'suggested_calc', id from new_calc;

select throws_ok(
  format($$select publish_suggested_price('%s')$$, (select id from test_ids_pp where key = 'suggested_calc')),
  null, null,
  'cannot publish a price with status other than approved'
);

-- Test 4: set_price_override creates override for a specific store.
select ok(
  (
    with override_set as (
      select set_price_override(
        (select id from test_ids_pp where key = 'published'),
        (select id from test_ids_pp where key = 'node'),
        22.50, 'event_promotion'
      )
    )
    select exists(
      select 1 from published_price_overrides
      where override_amount = 22.50 and reason = 'event_promotion'
    )
  ),
  'set_price_override() creates override row'
);

-- Test 5: set_price_override emits pricing_override_set event.
select ok(
  exists(
    select 1 from integration_events
    where event_type = 'pricing_override_set'
  ),
  'set_price_override() emits pricing_override_set integration event'
);

-- Test 6: Override at one store doesn't affect other stores' base price.
-- Query the published_prices table: central price should still be 20.15.
select ok(
  (
    select exists(
      select 1 from published_prices where final_amount = 20.15 and status = 'active'
    )
  ),
  'central published_price remains unchanged when store override is set'
);

-- Test 7: Cannot set override with negative amount.
select throws_ok(
  format(
    $$select set_price_override('%s', '%s', -5.00)$$,
    (select id from test_ids_pp where key = 'published'),
    (select id from test_ids_pp where key = 'node')
  ),
  null, null,
  'cannot set override with negative amount'
);

-- Test 8: Updating override amount works (upsert behavior).
select ok(
  (
    with override_updated as (
      select set_price_override(
        (select id from test_ids_pp where key = 'published'),
        (select id from test_ids_pp where key = 'node'),
        23.50, 'revised_event_price'
      )
    )
    select exists(
      select 1 from published_price_overrides
      where override_amount = 23.50 and reason = 'revised_event_price'
    )
  ),
  'set_price_override() updates existing override'
);

-- Test 9: clear_price_override removes the override.
select ok(
  (
    with cleared as (
      select clear_price_override(
        (select id from test_ids_pp where key = 'published'),
        (select id from test_ids_pp where key = 'node')
      )
    )
    select not exists(
      select 1 from published_price_overrides
      where published_price_id = (select id from test_ids_pp where key = 'published')
    )
  ),
  'clear_price_override() removes override'
);

-- Test 10: clear_price_override emits pricing_override_cleared event.
select ok(
  exists(
    select 1 from integration_events
    where event_type = 'pricing_override_cleared'
  ),
  'clear_price_override() emits pricing_override_cleared integration event'
);

-- Test 11: Cannot clear a non-existent override.
select throws_ok(
  format(
    $$select clear_price_override('%s', '%s')$$,
    (select id from test_ids_pp where key = 'published'),
    (select id from test_ids_pp where key = 'node')
  ),
  null, null,
  'cannot clear a non-existent override'
);

-- Test 12: Cannot set override for node in different organisation.
select throws_ok(
  format(
    $$select set_price_override('%s', '%s', 25.00)$$,
    (select id from test_ids_pp where key = 'published'),
    (select id from test_ids_pp where key = 'other_org_node')
  ),
  null, null,
  'cannot set override for node in different organisation'
);

-- Test 13: published_prices has its lookup index on sellable_sku_id (a
-- plain index, not a constraint -- information_schema.constraint_column_usage
-- only lists PK/FK/unique/check constraints, so it can never see this).
select ok(
  exists(
    select 1 from pg_indexes
    where tablename = 'published_prices' and indexname = 'published_prices_sku_idx'
  ),
  'published_prices has required indexes'
);

-- Test 14: RLS policy exists for staff access.
select ok(
  exists(
    select 1 from pg_policies
    where tablename = 'published_prices' and policyname = 'published_prices_select'
  ),
  'RLS select policy exists on published_prices'
);

-- Test 15: RLS policy exists for public/customer access (B-102 — the
-- storefront needs to show the current price without a staff session).
select ok(
  exists(
    select 1 from pg_policies
    where tablename = 'published_prices' and policyname = 'published_prices_select_public'
  ),
  'RLS select policy exists for anon/authenticated access to active published prices'
);

-- Test 16: the public policy is scoped to active status only, not a blanket
-- grant — archived/suspended prices must stay off the storefront.
select ok(
  (
    select qual like '%status = ''active''%' or qual like '%(status = ''active''::text)%'
    from pg_policies
    where tablename = 'published_prices' and policyname = 'published_prices_select_public'
  ),
  'public published_prices policy is scoped to active status only'
);

select finish();

rollback;
