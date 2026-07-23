-- pgTAP tests for the pricing engine schema (backlog B-160). Core ACs:
-- schema supports margin rules, condition modifiers, currency conversion,
-- and stock-based modifiers; a calculated price stores every component
-- that produced its final amount, and is traceable to its source
-- price_snapshots rows.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(10);

create temp table test_ids_pr (key text primary key, id uuid);
grant select, insert on test_ids_pr to authenticated, anon;

insert into test_ids_pr (key, id) select 'org', id from organisations limit 1;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'prrtst', 'Pricing Rules Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001601', 'Pricing Rules Test Card', 'Instant' from g
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
insert into test_ids_pr (key, id) select 'sku', id from sku;

with src as (
  insert into price_sources (code, name) values ('test_pr_source', 'Test PR Source') returning id
)
insert into test_ids_pr (key, id) select 'source', id from src;

with run as (
  insert into price_import_runs (price_source_id, source_ref)
  select (select id from test_ids_pr where key = 'source'), 'daily:2026-07-23-pr-test'
  returning id
)
insert into test_ids_pr (key, id) select 'run', id from run;

with snap as (
  insert into price_snapshots (
    price_import_run_id, price_source_id, provider, source_product_id,
    card_printing_id, language, finish, price_type, amount, currency, observed_at
  )
  select
    (select id from test_ids_pr where key = 'run'), (select id from test_ids_pr where key = 'source'),
    'tcgplayer', 'uuid-1', (select cp.id from card_printings cp join sellable_skus sk on sk.card_printing_id = cp.id where sk.id = (select id from test_ids_pr where key = 'sku')),
    'en', 'normal', 'market', 5.00, 'USD', now()
  returning id
)
insert into test_ids_pr (key, id) select 'snapshot', id from snap;

-- Margin rule: 20% margin on market price, target currency AUD.
with rule as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_pr where key = 'org'), 'Test Standard Margin', 'market', 'AUD', 'percentage', 20
  returning id
)
insert into test_ids_pr (key, id) select 'rule', id from rule;

select ok(
  (select margin_value = 20 and target_currency = 'AUD' and source_price_type = 'market' from pricing_rules where id = (select id from test_ids_pr where key = 'rule')),
  'a pricing_rule stores the margin/currency/source-price configuration'
);

select throws_ok(
  format(
    $$insert into pricing_rules (organisation_id, name) values ('%s', 'Test Standard Margin')$$,
    (select id from test_ids_pr where key = 'org')
  ),
  null, null,
  'a duplicate rule name within the same organisation is rejected'
);

insert into pricing_condition_modifiers (pricing_rule_id, condition, modifier_type, modifier_value)
values
  ((select id from test_ids_pr where key = 'rule'), 'LP', 'percentage', -15),
  ((select id from test_ids_pr where key = 'rule'), 'MP', 'percentage', -30);

select ok(
  (select count(*) = 2 from pricing_condition_modifiers where pricing_rule_id = (select id from test_ids_pr where key = 'rule')),
  'a rule supports multiple condition modifiers (margin rules + condition modifiers, B-160 core AC)'
);

select throws_ok(
  format(
    $$insert into pricing_condition_modifiers (pricing_rule_id, condition, modifier_type, modifier_value) values ('%s', 'LP', 'percentage', -10)$$,
    (select id from test_ids_pr where key = 'rule')
  ),
  null, null,
  'a duplicate condition modifier for the same (rule, condition) is rejected'
);

insert into pricing_stock_modifiers (pricing_rule_id, min_quantity, max_quantity, modifier_type, modifier_value)
values
  ((select id from test_ids_pr where key = 'rule'), 0, 4, 'percentage', 0),
  ((select id from test_ids_pr where key = 'rule'), 5, null, 'percentage', -10);

select ok(
  (select count(*) = 2 from pricing_stock_modifiers where pricing_rule_id = (select id from test_ids_pr where key = 'rule')),
  'a rule supports stock-based modifiers with an open-ended top band (stock-based modifiers, B-160 core AC)'
);

select throws_ok(
  format(
    $$insert into pricing_stock_modifiers (pricing_rule_id, min_quantity, max_quantity, modifier_type, modifier_value) values ('%s', 10, 5, 'percentage', -5)$$,
    (select id from test_ids_pr where key = 'rule')
  ),
  null, null,
  'a stock modifier band with max_quantity < min_quantity is rejected'
);

-- Calculated price: USD 5.00 market price -> AUD via a 1.55 exchange rate
-- -> +20% margin -> -15% LP condition modifier -> 0% stock modifier
-- (currency conversion + margin + condition + stock, all four components
-- of B-160's AC represented in one row).
with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, condition_modifier_amount, stock_modifier_amount, final_amount, currency
  )
  values (
    (select id from test_ids_pr where key = 'rule'),
    (select id from test_ids_pr where key = 'sku'),
    5.00, 'USD', 1.55,
    1.55, -1.16, 0, 7.14, 'AUD'
  )
  returning id
)
insert into test_ids_pr (key, id) select 'calc_price', id from cp;

select ok(
  (select status = 'suggested' and currency = 'AUD' and final_amount = 7.14 from calculated_prices where id = (select id from test_ids_pr where key = 'calc_price')),
  'a calculated_prices row stores every component (currency conversion, margin, condition/stock modifiers) plus the final amount'
);

insert into calculated_price_inputs (calculated_price_id, price_snapshot_id)
values ((select id from test_ids_pr where key = 'calc_price'), (select id from test_ids_pr where key = 'snapshot'));

select ok(
  (
    select ps.amount = 5.00 and ps.provider = 'tcgplayer'
    from calculated_price_inputs cpi
    join price_snapshots ps on ps.id = cpi.price_snapshot_id
    where cpi.calculated_price_id = (select id from test_ids_pr where key = 'calc_price')
  ),
  'a calculated price is traceable back to the exact price_snapshots row(s) that produced it (B-161 traceability AC)'
);

select throws_ok(
  format(
    $$insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, final_amount, currency) values ('%s', '%s', -1, 'USD', 5, 'AUD')$$,
    (select id from test_ids_pr where key = 'rule'),
    (select id from test_ids_pr where key = 'sku')
  ),
  null, null,
  'a negative base_amount is rejected by the check constraint'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001602', true);

select ok(
  (select count(*) >= 1 from calculated_prices where id = (select id from test_ids_pr where key = 'calc_price')),
  'authenticated staff can read calculated_prices'
);

reset role;

select finish();

rollback;
