-- pgTAP tests for pricing review queue (backlog B-163). Core AC: staff with
-- pricing.approve/pricing.override can review/override prices; a user
-- without that permission cannot via a direct API call; functions emit
-- integration events.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available -- wrapped in BEGIN/ROLLBACK so no fixture data is left behind.
-- Rewritten from the original: every fixture insert here used string
-- literals ('test-org-id', 'test-printing-id', 'en', 'nonfoil', 'nm') for
-- uuid foreign-key columns, which would fail at insert time (invalid input
-- syntax for type uuid) -- this version follows the same real-fixture
-- chain (games -> sets -> oracle_cards -> card_printings -> sellable_skus)
-- used by allocate_and_pick_inventory.test.sql and others.
begin;

select plan(13);

create temp table test_ids_prq (key text primary key, id uuid);
grant select, insert on test_ids_prq to authenticated;

insert into test_ids_prq (key, id) select 'org', id from organisations limit 1;

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_prq where key = 'org'), 'PRQ Test Rule', 'tcgplayer', 'AUD', 'percentage', 30
  returning id
)
insert into test_ids_prq (key, id) select 'rule', id from pr;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'prqt', 'Pricing Review Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001001', 'Pricing Review Test Card', 'Instant' from g
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
insert into test_ids_prq (key, id) select 'sku', id from sku;

-- A staff user WITH pricing.approve/pricing.override (role_permissions was
-- seeded for pricing_manager by 20260724221000_seed_pricing_role_permissions.sql).
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prq-manager@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_prq where key = 'org'), '00000000-0000-0000-0000-000000001002', 'pricing_manager', 'organisation';

-- A staff user WITHOUT any pricing permission (store_assistant has none of
-- pricing.view/approve/override) -- proves the permission check actually
-- denies, not just that a policy row exists.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prq-assistant@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_prq where key = 'org'), '00000000-0000-0000-0000-000000001003', 'store_assistant', 'organisation';

with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_prq where key = 'rule'), (select id from test_ids_prq where key = 'sku'),
    10, 'USD', 1.55, 4.65, 20.15, 'AUD', 'suggested'
  returning id
)
insert into test_ids_prq (key, id) select 'calc_1', id from cp;

-- Test: a user without pricing.approve cannot approve via a direct API call.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001003', true);
set local role authenticated;

select throws_ok(
  format($$select approve_suggested_price('%s')$$, (select id from test_ids_prq where key = 'calc_1')),
  '42501',
  null,
  'a user without pricing.approve cannot approve a suggested price'
);

select throws_ok(
  format($$select override_suggested_price('%s', 15.00)$$, (select id from test_ids_prq where key = 'calc_1')),
  '42501',
  null,
  'a user without pricing.override cannot override a suggested price'
);

select ok(
  (select status = 'suggested' from calculated_prices where id = (select id from test_ids_prq where key = 'calc_1')),
  'the denied calls above left the price untouched, still suggested'
);

reset role;

-- Switch to the pricing manager for the remaining, permitted actions.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001002', true);
set local role authenticated;

-- Test: approve_suggested_price transitions status from suggested to approved.
select ok(
  (
    with approved as (
      select approve_suggested_price((select id from test_ids_prq where key = 'calc_1'))
    )
    select exists(
      select 1 from calculated_prices
      where id = (select id from test_ids_prq where key = 'calc_1') and status = 'approved'
    )
  ),
  'approve_suggested_price() transitions status to approved for a permitted user'
);

select ok(
  exists(select 1 from integration_events where event_type = 'pricing_approved'),
  'approve_suggested_price() emits a pricing_approved integration event'
);

select throws_ok(
  format($$select approve_suggested_price('%s')$$, (select id from test_ids_prq where key = 'calc_1')),
  null, null,
  'cannot approve an already-approved price'
);

with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_prq where key = 'rule'), (select id from test_ids_prq where key = 'sku'),
    15, 'USD', 1.55, 6.98, 30.23, 'AUD', 'suggested'
  returning id
)
insert into test_ids_prq (key, id) select 'calc_2', id from cp;

select ok(
  (
    with overridden as (
      select override_suggested_price((select id from test_ids_prq where key = 'calc_2'), 25.00)
    )
    select exists(
      select 1 from calculated_prices
      where id = (select id from test_ids_prq where key = 'calc_2')
        and final_amount = 25.00
        and status = 'approved'
        and metadata->>'original_final_amount' = '30.23'
    )
  ),
  'override_suggested_price() updates amount, status, and stores original in metadata'
);

select ok(
  exists(select 1 from integration_events where event_type = 'pricing_overridden'),
  'override_suggested_price() emits a pricing_overridden integration event'
);

select throws_ok(
  format($$select override_suggested_price('%s', -5.00)$$, (select id from test_ids_prq where key = 'calc_2')),
  null, null,
  'cannot override with negative amount'
);

with cp as (
  insert into calculated_prices (
    pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
    margin_amount, final_amount, currency, status
  )
  select (select id from test_ids_prq where key = 'rule'), (select id from test_ids_prq where key = 'sku'),
    20, 'USD', 1.55, 9.30, 40.30, 'AUD', 'suggested'
  returning id
)
insert into test_ids_prq (key, id) select 'calc_3', id from cp;

select ok(
  (
    with rejected as (
      select reject_suggested_price((select id from test_ids_prq where key = 'calc_3'))
    )
    select exists(
      select 1 from calculated_prices
      where id = (select id from test_ids_prq where key = 'calc_3') and status = 'rejected'
    )
  ),
  'reject_suggested_price() transitions status to rejected'
);

select ok(
  exists(select 1 from integration_events where event_type = 'pricing_rejected'),
  'reject_suggested_price() emits a pricing_rejected integration event'
);

select throws_ok(
  format($$select reject_suggested_price('%s')$$, (select id from test_ids_prq where key = 'calc_1')),
  null, null,
  'cannot reject an already-approved price'
);

reset role;

select finish();

rollback;
