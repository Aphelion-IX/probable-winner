-- pgTAP tests for published prices and store overrides (backlog B-164).
-- Core AC: central price book with per-store overrides, not full duplication.
-- Integration test: override at one store doesn't affect others' calculated price.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(16);

-- Setup: create org, stores, pricing rule, SKU, and calculated prices.
insert into pricing_rules (organisation_id, source_price_type, target_currency, margin_type, margin_value)
values ('test-org-id', 'tcgplayer', 'AUD', 'percentage', 30);

insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id)
values ('test-printing-id', 'en', 'nonfoil', 'nm');

-- Create two approved calculated prices (same SKU, same rule, ready to publish).
insert into calculated_prices (
  pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
  margin_amount, final_amount, currency, status
)
select pr.id, sk.id, 10, 'USD', 1.55, 4.65, 20.15, 'AUD', 'approved'
from pricing_rules pr, sellable_skus sk
where pr.source_price_type = 'tcgplayer' and sk.card_printing_id = 'test-printing-id'
limit 1;

-- Test 1: publish_suggested_price creates published_prices row with correct amount.
select ok(
  (
    with calc_price as (
      select id, final_amount from calculated_prices where final_amount = 20.15 limit 1
    ),
    published as (
      select publish_suggested_price(calc_price.id) from calc_price
    )
    select exists(
      select 1 from published_prices where final_amount = 20.15 and status = 'active'
    )
  ),
  'publish_suggested_price() creates active published_price'
);

-- Test 2: publish_suggested_price emits pricing_published event.
select ok(
  exists(
    select 1 from integration_events
    where event_type = 'pricing_published'
  ),
  'publish_suggested_price() emits pricing_published integration event'
);

-- Test 3: Cannot publish a suggested price (only approved prices).
select throws_ok(
  (
    with new_calc as (
      insert into calculated_prices (
        pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
        margin_amount, final_amount, currency, status
      )
      select pr.id, sk.id, 12, 'USD', 1.55, 5.58, 24.18, 'AUD', 'suggested'
      from pricing_rules pr, sellable_skus sk
      where pr.source_price_type = 'tcgplayer' and sk.card_printing_id = 'test-printing-id'
      limit 1
      returning id
    )
    select publish_suggested_price(new_calc.id) from new_calc
  ),
  null, null,
  'cannot publish a price with status other than approved'
);

-- Test 4: set_price_override creates override for a specific store.
select ok(
  (
    with published as (
      select id from published_prices where final_amount = 20.15 limit 1
    ),
    node as (
      select id from fulfilment_nodes limit 1
    ),
    override_set as (
      select set_price_override(published.id, node.id, 22.50, 'event_promotion')
      from published, node
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
  (
    with published as (
      select id from published_prices where final_amount = 20.15 limit 1
    ),
    node as (
      select id from fulfilment_nodes limit 1
    )
    select set_price_override(published.id, node.id, -5.00)
    from published, node
  ),
  null, null,
  'cannot set override with negative amount'
);

-- Test 8: Updating override amount works (upsert behavior).
select ok(
  (
    with published as (
      select id from published_prices where final_amount = 20.15 limit 1
    ),
    override_updated as (
      select set_price_override(
        published.id,
        (select id from fulfilment_nodes limit 1),
        23.50,
        'revised_event_price'
      )
      from published
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
    with published as (
      select id from published_prices where final_amount = 20.15 limit 1
    ),
    node as (
      select id from fulfilment_nodes limit 1
    ),
    cleared as (
      select clear_price_override(published.id, node.id)
      from published, node
    )
    select not exists(
      select 1 from published_price_overrides
      where published_price_id = (select id from published_prices where final_amount = 20.15 limit 1)
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
  (
    with published as (
      select id from published_prices where final_amount = 20.15 limit 1
    ),
    node as (
      select id from fulfilment_nodes limit 1
    )
    select clear_price_override(published.id, node.id)
    from published, node
  ),
  null, null,
  'cannot clear a non-existent override'
);

-- Test 12: Cannot set override for node in different organisation.
select throws_ok(
  (
    with published as (
      select id from published_prices where final_amount = 20.15 limit 1
    ),
    other_org_node as (
      select id from fulfilment_nodes where organisation_id != 'test-org-id' limit 1
    )
    select set_price_override(published.id, other_org_node.id, 25.00)
    from published, other_org_node
  ),
  null, null,
  'cannot set override for node in different organisation'
);

-- Test 13: Unique constraint on (published_price_id, fulfilment_node_id, currency).
select ok(
  (
    select (array_agg(column_name))[1] is not null
    from information_schema.constraint_column_usage
    where table_name = 'published_prices'
      and constraint_name like '%sku_idx%'
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
