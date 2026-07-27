-- pgTAP tests for the anon EXECUTE grant fix (backlog: guest browsing was
-- completely broken -- confirmed live in a real browser, not just by
-- reading policy definitions). staff_has_node_access()/staff_has_org_access()
-- were revoked from anon by 20260722082938_lock_down_rls_helper_function_execute.sql,
-- correct at the time (every policy referencing them was authenticated-only
-- then), but later migrations added anon to fulfilment_nodes_select/
-- published_prices_select/inventory_balances_select/store_addresses_select
-- without revisiting that grant -- so every anon select against any of
-- those four tables threw "permission denied for function", not a merely
-- filtered result. 20260727080000_grant_rls_helper_execute_to_anon.sql
-- fixes it; this test would have caught the regression the moment it was
-- introduced, unlike reading the policy SQL alone (which looks correct --
-- `anon` is right there in the role list).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Wrapped in BEGIN/ROLLBACK so no fixture data is left behind.
begin;

select plan(5);

create temp table test_ids_grh (key text primary key, id uuid);
grant select, insert on test_ids_grh to authenticated, anon;

insert into test_ids_grh (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_online_fulfilment)
  select (select id from test_ids_grh where key = 'org'), 'GRH Test Store', 'grhtest', 'store', true, true
  returning id
)
insert into test_ids_grh (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'grhtst', 'GRH Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000002201', 'GRH Test Card', 'Instant' from g
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
insert into test_ids_grh (key, id) select 'sku', id from sku;

with pr as (
  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  select (select id from test_ids_grh where key = 'org'), 'GRH Test Rule', 'market', 'AUD', 'percentage', 30
  returning id
),
cp as (
  insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, final_amount, currency, status)
  select pr.id, (select id from test_ids_grh where key = 'sku'), 10, 'AUD', 10, 'AUD', 'approved'
  from pr
  returning pricing_rule_id, id
)
insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency)
select (select id from test_ids_grh where key = 'org'), cp.pricing_rule_id, (select id from test_ids_grh where key = 'sku'), cp.id, 10, 'AUD'
from cp;

set local role anon;

select lives_ok(
  $$select staff_has_node_access('00000000-0000-0000-0000-000000000000'::uuid)$$,
  'anon can call staff_has_node_access() at all (returns false, does not error)'
);

select lives_ok(
  $$select staff_has_org_access('00000000-0000-0000-0000-000000000000'::uuid)$$,
  'anon can call staff_has_org_access() at all (returns false, does not error)'
);

select lives_ok(
  format(
    $$select count(*) from fulfilment_nodes where id = '%s'$$,
    (select id from test_ids_grh where key = 'node')
  ),
  'anon can select from fulfilment_nodes (its public-read policy references staff_has_node_access())'
);

select lives_ok(
  format(
    $$select count(*) from published_prices where sellable_sku_id = '%s'$$,
    (select id from test_ids_grh where key = 'sku')
  ),
  'anon can select from published_prices (its public-read policy references staff_has_org_access())'
);

select lives_ok(
  format(
    $$select count(*) from inventory_balances where fulfilment_node_id = '%s'$$,
    (select id from test_ids_grh where key = 'node')
  ),
  'anon can select from inventory_balances (its public-read policy references staff_has_node_access())'
);

reset role;

select finish();

rollback;
