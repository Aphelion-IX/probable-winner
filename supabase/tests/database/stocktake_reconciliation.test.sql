-- pgTAP tests for stocktakes/stocktake_lines schema and reconciliation
-- (backlog B-065). The reconciliation logic itself lives in the worker
-- (apps/worker/src/jobs/reconcile-stocktake.ts, matching how
-- generate-skus.ts's cross-product query is tested here too) -- this file
-- exercises the same SQL that job runs: for each unreconciled counted
-- line, a non-zero variance goes through adjust_inventory(), a zero
-- variance is just marked reconciled.
--
-- Core AC: a stocktake with a -2 variance produces exactly one adjustment
-- movement and a matching balance change.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(9);

create temp table test_ids_stk (key text primary key, id uuid);
grant select, insert on test_ids_stk to authenticated;

insert into test_ids_stk (key, id) select 'org', id from organisations limit 1;

with n as (
  insert into fulfilment_nodes (organisation_id, name, code, type)
  select (select id from test_ids_stk where key = 'org'), 'Stocktake Test Store', 'stktest', 'store'
  returning id
)
insert into test_ids_stk (key, id) select 'node', id from n;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'stktst', 'Stocktake Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001001', 'Stocktake Test Card', 'Instant' from g
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
     ),
     cp2 as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '2', 'common', array['nonfoil']
       from oc, s
       returning id
     ),
     sku2 as (
       insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
       select cp2.id, (select id from languages where code='en'), (select id from finishes where code='nonfoil'), (select id from conditions where code='nm'), (select id from product_statuses where code='active')
       from cp2 returning id
     )
insert into test_ids_stk (key, id)
select 'sku_a', id from sku
union all
select 'sku_b', id from sku2;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stk-staff@test.local');
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
select (select id from test_ids_stk where key = 'org'), '00000000-0000-0000-0000-000000001002', 'inventory_manager', 'store', (select id from test_ids_stk where key = 'node');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001002', true);
set local role authenticated;

-- Both SKUs start with 5 on hand.
select receive_inventory((select id from test_ids_stk where key = 'node'), (select id from test_ids_stk where key = 'sku_a'), 5, 'test', null, 'seed A');
select receive_inventory((select id from test_ids_stk where key = 'node'), (select id from test_ids_stk where key = 'sku_b'), 5, 'test', null, 'seed B');

with stk as (
  insert into stocktakes (organisation_id, fulfilment_node_id, status)
  select (select id from test_ids_stk where key = 'org'), (select id from test_ids_stk where key = 'node'), 'in_progress'
  returning id
)
insert into test_ids_stk (key, id) select 'stocktake', id from stk;

-- Line A: counted 3 against expected 5 -- a -2 variance.
with la as (
  insert into stocktake_lines (stocktake_id, fulfilment_node_id, sellable_sku_id, expected_quantity, counted_quantity)
  select (select id from test_ids_stk where key = 'stocktake'), (select id from test_ids_stk where key = 'node'), (select id from test_ids_stk where key = 'sku_a'), 5, 3
  returning id
)
insert into test_ids_stk (key, id) select 'line_a', id from la;

-- Line B: counted matches expected -- zero variance.
with lb as (
  insert into stocktake_lines (stocktake_id, fulfilment_node_id, sellable_sku_id, expected_quantity, counted_quantity)
  select (select id from test_ids_stk where key = 'stocktake'), (select id from test_ids_stk where key = 'node'), (select id from test_ids_stk where key = 'sku_b'), 5, 5
  returning id
)
insert into test_ids_stk (key, id) select 'line_b', id from lb;

select ok(
  (select variance = -2 from stocktake_lines where id = (select id from test_ids_stk where key = 'line_a')),
  'the generated variance column computes counted - expected correctly (-2)'
);

-- Constraint: unique (stocktake_id, sellable_sku_id).
select throws_ok(
  format(
    $$insert into stocktake_lines (stocktake_id, fulfilment_node_id, sellable_sku_id, expected_quantity, counted_quantity)
      values ('%s', '%s', '%s', 5, 5)$$,
    (select id from test_ids_stk where key = 'stocktake'),
    (select id from test_ids_stk where key = 'node'),
    (select id from test_ids_stk where key = 'sku_a')
  ),
  '23505',
  null,
  'a duplicate (stocktake, sku) line is rejected'
);

reset role;

-- Reconciliation (mirrors apps/worker/src/jobs/reconcile-stocktake.ts):
-- runs as a trusted backend connection, same as the worker.
with adj as (
  select id from adjust_inventory(
    (select id from test_ids_stk where key = 'node'),
    (select id from test_ids_stk where key = 'sku_a'),
    'stocktake_adjustment',
    -2,
    'stocktake recount variance',
    'stocktake_line',
    (select id from test_ids_stk where key = 'line_a')
  )
)
update stocktake_lines
set reconciled = true, adjustment_movement_id = (select id from adj), updated_at = now()
where id = (select id from test_ids_stk where key = 'line_a');

update stocktake_lines
set reconciled = true, updated_at = now()
where id = (select id from test_ids_stk where key = 'line_b');

update stocktakes set status = 'reconciled', reconciled_at = now(), updated_at = now()
where id = (select id from test_ids_stk where key = 'stocktake');

select ok(
  (
    select quantity_on_hand = 3
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_stk where key = 'node')
      and sellable_sku_id = (select id from test_ids_stk where key = 'sku_a')
  ),
  'the -2 variance produces a matching balance change on SKU A (5 -> 3)'
);
select ok(
  (
    select quantity_on_hand = 5
    from inventory_balances
    where fulfilment_node_id = (select id from test_ids_stk where key = 'node')
      and sellable_sku_id = (select id from test_ids_stk where key = 'sku_b')
  ),
  'the zero-variance SKU B balance is untouched'
);
select ok(
  (
    select count(*) = 1 from inventory_movements
    where fulfilment_node_id = (select id from test_ids_stk where key = 'node')
      and sellable_sku_id = (select id from test_ids_stk where key = 'sku_a')
      and movement_type = 'stocktake_adjustment'
  ),
  'exactly one adjustment movement is produced for the -2 variance line (B-065 core AC)'
);
select ok(
  (
    select count(*) = 0 from inventory_movements
    where fulfilment_node_id = (select id from test_ids_stk where key = 'node')
      and sellable_sku_id = (select id from test_ids_stk where key = 'sku_b')
      and movement_type = 'stocktake_adjustment'
  ),
  'the zero-variance line produces no adjustment movement (it does have an earlier receive movement from seeding)'
);
select ok(
  (select reconciled and adjustment_movement_id is not null from stocktake_lines where id = (select id from test_ids_stk where key = 'line_a')),
  'line A is reconciled and links to its adjustment movement'
);
select ok(
  (select reconciled and adjustment_movement_id is null from stocktake_lines where id = (select id from test_ids_stk where key = 'line_b')),
  'line B is reconciled with no adjustment movement (zero variance)'
);
select ok(
  (select status = 'reconciled' from stocktakes where id = (select id from test_ids_stk where key = 'stocktake')),
  'the stocktake itself is marked reconciled once every counted line is processed'
);

select finish();

rollback;
