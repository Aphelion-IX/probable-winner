-- pgTAP test for B-165: publishing a price writes an integration event
-- consumed by the same outbox path as inventory changes (B-083), not a
-- separate ad hoc sync -- and that event carries the sellableSkuId the
-- search_index consumer needs to rebuild the right Typesense document.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available -- wrapped in BEGIN/ROLLBACK so no fixture data is left behind.
-- The consumer side (search-index-consumer.ts correctly extracting
-- sellableSkuId and calling updateSearchDocument for any event carrying
-- it, pricing_published included) is covered by
-- apps/worker/src/consumers/search-index-consumer.test.ts.
begin;

select plan(4);

create temp table test_ids_ppr (key text primary key, id uuid);

insert into test_ids_ppr (key, id) select 'org', id from organisations limit 1;

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_ppr where key = 'org'), 'PPR Test Rule', 'tcgplayer', 'AUD', 'percentage', 30
  returning id
)
insert into test_ids_ppr (key, id) select 'rule', id from pr;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'pprt', 'Pricing Publish Reindex Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001101', 'Pricing Publish Reindex Test Card', 'Instant' from g
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
insert into test_ids_ppr (key, id) select 'sku', id from sku;

with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_ppr where key = 'rule'), (select id from test_ids_ppr where key = 'sku'),
    10, 'USD', 1.55, 4.65, 20.15, 'AUD', 'approved'
  returning id
)
insert into test_ids_ppr (key, id) select 'calc', id from cp;

with pub as (
  select publish_suggested_price((select id from test_ids_ppr where key = 'calc')) as result
)
insert into test_ids_ppr (key, id) select 'published_price', (result->>'id')::uuid from pub;

select ok(
  (
    select status = 'active' and final_amount = 20.15
    from published_prices
    where id = (select id from test_ids_ppr where key = 'published_price')
  ),
  'publish_suggested_price() creates an active published_price'
);

select ok(
  exists(
    select 1 from integration_events
    where aggregate_type = 'published_price'
      and aggregate_id = (select id from test_ids_ppr where key = 'published_price')
      and event_type = 'pricing_published'
      and (payload->>'sellableSkuId')::uuid = (select id from test_ids_ppr where key = 'sku')
  ),
  'publish_suggested_price() emits a pricing_published event carrying the sellableSkuId'
);

-- Same outbox path as every other atomic function (B-083/B-165's AC),
-- not a separate ad hoc sync: emit_integration_event() enqueues to the
-- search_index pgmq queue, keyed by the integration_events row's id.
select ok(
  (
    select count(*) = 1
    from pgmq.q_search_index
    where (message->>'integrationEventId')::uuid = (
      select id from integration_events
      where aggregate_type = 'published_price'
        and aggregate_id = (select id from test_ids_ppr where key = 'published_price')
        and event_type = 'pricing_published'
    )
  ),
  'publish_suggested_price() enqueues a search_index message referencing that integration_event'
);

-- Guards against reintroducing a separate ad hoc queue keyed off the
-- integration_events table's own name (what the old, dead
-- pricing-publish-consumer.ts polled) -- checked via pgmq.metrics_all(),
-- which lists every real queue, rather than querying a per-queue table
-- directly, since a queue that was never created has no such table at all.
select ok(
  not exists(select 1 from pgmq.metrics_all() where queue_name = 'integration_events'),
  'no separate ad hoc "integration_events" pgmq queue exists -- the outbox path is the only one'
);

select finish();

rollback;
