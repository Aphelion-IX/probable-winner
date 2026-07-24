-- Extends seed_perf_test.sql with the operational data B-211's load-test
-- scenarios need but B-210 didn't generate: staff actors, order/inventory
-- allocations, pick batches, historical transfers, and pricing. Blueprint
-- §23 lists pricing rules (50+) and historical transfers (10,000+) as part
-- of the seeded-data minimums; B-210 only covered catalogue/inventory/
-- customers/orders/carts. This file closes that gap so "bulk repricing",
-- "transfer receiving", and "1000-line picking" have real data behind
-- them, not empty tables.
--
-- Same conventions as seed_perf_test.sql (see its header for the
-- random()-in-a-subquery trap this file was rewritten to avoid after
-- hitting it live): run phase by phase via the Supabase MCP execute_sql
-- tool, raise statement_timeout per phase, and poll pg_stat_activity for
-- completion on anything exceeding the tool's ~60s client wait. Tagged
-- for cleanup:
--   - staff auth.users: email like 'perftest-staff+%@perftest.invalid'
--   - everything else here has no independent real-world equivalent yet
--     (order_allocations/inventory_allocations/pick_batches/pick_lines/
--     transfer_orders/pricing_rules/calculated_prices/published_prices
--     were all 0 rows before this script), so cleanup for those is a
--     plain TRUNCATE -- see seed_perf_test_cleanup.sql.

-- ============================================================
-- Phase O1: Staff actors. 4 roles x 4 stores = 16 staff users,
-- store-scoped, needed as FK targets for pick_batches/transfers
-- (created_by_user_id, requested_by, dispatched_by, received_by)
-- -- no staff had ever been provisioned in this live project.
-- ============================================================
with new_staff as (
  insert into auth.users (
    instance_id, id, aud, role, email,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    is_sso_user, is_anonymous, created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    gen_random_uuid(),
    'authenticated', 'authenticated',
    'perftest-staff+' || lpad(g::text, 5, '0') || '@perftest.invalid',
    now(), '{"provider":"email","providers":["email"],"perf_seed":true}'::jsonb, '{}'::jsonb,
    false, false, now(), now()
  from generate_series(1, 16) g
  returning id as user_id
),
staff_seed as (
  select row_number() over (order by user_id) as n, user_id from new_staff
),
node as (
  select id, row_number() over (order by code) - 1 as rn from fulfilment_nodes
),
node_total as (select count(*) as cnt from node)
insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id, active)
select
  '58a5ac20-5aa2-43d8-be60-274e9d8de220',
  s.user_id,
  (array['store_manager', 'store_assistant', 'warehouse_picker', 'inventory_manager'])[1 + ((s.n - 1) % 4)],
  'store',
  nd.id,
  true
from staff_seed s
join node nd on nd.rn = ((s.n - 1) / 4) % (select cnt from node_total);

-- ============================================================
-- Phase O2: order_allocations + inventory_allocations for every
-- order_line whose order isn't pending/cancelled (~95% of lines
-- -- an order that's been paid or further along must have
-- allocated stock somewhere). status mirrors order status:
-- paid -> 'allocated'; anything past that -> 'picked' (no order
-- status in this seed maps to inventory_allocations' 'picking').
-- ============================================================
with eligible as materialized (
  select ol.id as order_line_id, ol.sellable_sku_id, ol.quantity, o.id as order_id, o.fulfilment_node_id, o.status, o.created_at
  from order_lines ol
  join orders o on o.id = ol.order_id
  where o.status not in ('pending', 'cancelled')
),
ins_oa as (
  insert into order_allocations (order_id, order_line_id, allocated_to_node_id, quantity, routing_reason, allocated_at)
  select order_id, order_line_id, fulfilment_node_id, quantity, 'perf_seed_direct_fulfilment', created_at
  from eligible
  returning 1
)
insert into inventory_allocations (organisation_id, fulfilment_node_id, sellable_sku_id, order_line_id, quantity, status, created_at, updated_at)
select
  '58a5ac20-5aa2-43d8-be60-274e9d8de220', fulfilment_node_id, sellable_sku_id, order_line_id, quantity,
  case when status = 'paid' then 'allocated' else 'picked' end,
  created_at, created_at
from eligible;

-- ============================================================
-- Phase O3: Pick batches + pick_lines from the 'allocated'
-- inventory_allocations (~13,000 lines, well over the 1,000-line
-- scenario target). 8 batches per store, ~400 lines each,
-- created by that store's warehouse_picker/inventory_manager.
-- Batches are created first as plain rows (no data to derive
-- from), then allocations are assigned to them by row_number()
-- modulo -- avoids the RETURNING-can't-surface-arbitrary-columns
-- trap that bit order_lines' status/n_lines correlation earlier.
-- ============================================================
with node_staff as (
  select fulfilment_node_id, (array_agg(user_id))[1] as user_id
  from staff_memberships
  where role_code in ('warehouse_picker', 'inventory_manager')
  group by fulfilment_node_id
)
insert into pick_batches (organisation_id, fulfilment_node_id, status, created_by_user_id, created_at)
select '58a5ac20-5aa2-43d8-be60-274e9d8de220', ns.fulfilment_node_id, 'pending', ns.user_id, now()
from node_staff ns
cross join generate_series(1, 8);

with batch_rank as (
  select id, fulfilment_node_id, row_number() over (partition by fulfilment_node_id order by id) - 1 as brn
  from pick_batches
),
alloc_rank as (
  select
    ia.id as allocation_id, ia.order_line_id, ia.sellable_sku_id, ia.fulfilment_node_id, ia.quantity,
    row_number() over (partition by ia.fulfilment_node_id order by ia.id) - 1 as arn
  from inventory_allocations ia
  where ia.status = 'allocated'
)
insert into pick_lines (pick_batch_id, order_line_id, allocation_id, sku_id, quantity_to_pick, sort_order)
select br.id, ar.order_line_id, ar.allocation_id, ar.sellable_sku_id, ar.quantity, ar.arn
from alloc_rank ar
join batch_rank br on br.fulfilment_node_id = ar.fulfilment_node_id and br.brn = ar.arn % 8;

-- ============================================================
-- Phase O4: Historical transfers -- target 12,000+ transfer_orders
-- (20% buffer over the 10,000+ minimum), 1-5 lines each. status
-- weighted toward 'received' (historical = mostly complete);
-- shipments generated for dispatched-or-later, receipts for
-- received/partially_received. r/created_at/n_lines are plain
-- per-row columns in a `raw` CTE (not wrapped in any lateral
-- subquery) -- status is derived from r in a separate `picked`
-- CTE since a CASE can't reference a column defined earlier in
-- the same SELECT list.
-- ============================================================
with node as (
  select id, row_number() over (order by code) - 1 as rn from fulfilment_nodes
),
node_total as (select count(*) as cnt from node),
staff_by_node as (
  select fulfilment_node_id, (array_agg(user_id))[1] as user_id
  from staff_memberships group by fulfilment_node_id
),
raw as materialized (
  select
    g as n,
    ns.id as src_node_id,
    nd.id as dst_node_id,
    floor(random() * 100)::int as r,
    now() - (random() * interval '180 days') as created_at,
    1 + floor(random() * 5)::int as n_lines
  from generate_series(1, 12000) g
  join node ns on ns.rn = (g % (select cnt from node_total))
  join node nd on nd.rn = ((g + 1 + floor(random() * 3)::int) % (select cnt from node_total))
  where ns.rn != nd.rn
),
picked as materialized (
  select n, src_node_id, dst_node_id, created_at, n_lines,
    (case
      when r < 70 then 'received'
      when r < 80 then 'partially_received'
      when r < 88 then 'in_transit'
      when r < 94 then 'dispatched'
      when r < 98 then 'accepted'
      else 'requested'
    end) as status
  from raw
)
insert into transfer_orders (organisation_id, source_fulfilment_node_id, destination_fulfilment_node_id, status, requested_by, created_at, updated_at)
select '58a5ac20-5aa2-43d8-be60-274e9d8de220', p.src_node_id, p.dst_node_id, p.status, sn.user_id, p.created_at, p.created_at
from picked p
join staff_by_node sn on sn.fulfilment_node_id = p.dst_node_id;

-- Lines: n_lines derived by hashing the (already-inserted, real)
-- transfer_order_id rather than re-deriving from `picked`, since
-- there's no shared key to correlate a fresh INSERT's RETURNING
-- output back to an unrelated CTE's row order (row_number() over
-- two independently-ordered CTEs is NOT guaranteed to align --
-- this bit order_lines earlier via a similar mistake).
with hashed as materialized (
  select
    id as transfer_order_id, created_at,
    1 + (abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 5) as n_lines
  from transfer_orders
),
sku_total as (select count(*) as cnt from sellable_skus),
sku_pool as (
  select id, row_number() over (order by id) - 1 as rn from sellable_skus
),
line_seed as materialized (
  select
    h.transfer_order_id, h.created_at, gs.line_no,
    floor(random() * (select cnt from sku_total))::bigint as pick_rn,
    1 + floor(random() * 20)::int as qty_requested
  from hashed h
  cross join lateral generate_series(1, h.n_lines) as gs(line_no)
)
insert into transfer_order_lines (transfer_order_id, sellable_sku_id, quantity_requested, created_at)
select ls.transfer_order_id, sp.id, ls.qty_requested, ls.created_at
from line_seed ls
join sku_pool sp on sp.rn = ls.pick_rn
-- one transfer, picked twice, landing on the same SKU by chance
on conflict (transfer_order_id, sellable_sku_id) do nothing;

-- Shipments: one per transfer_order dispatched or further along.
with eligible as materialized (
  select id as transfer_order_id, source_fulfilment_node_id, status, created_at
  from transfer_orders
  where status in ('dispatched', 'in_transit', 'partially_received', 'received')
),
staff_by_node as (
  select fulfilment_node_id, (array_agg(user_id))[1] as user_id
  from staff_memberships group by fulfilment_node_id
)
insert into transfer_shipments (transfer_order_id, dispatched_by, dispatched_at)
select e.transfer_order_id, sn.user_id, e.created_at + interval '1 day'
from eligible e
join staff_by_node sn on sn.fulfilment_node_id = e.source_fulfilment_node_id;

-- Receipts: one per line of a received/partially_received
-- transfer. 'received' -> full quantity (occasionally with a
-- damaged unit); 'partially_received' -> roughly half good, half
-- missing. Every branch guarantees at least 1 unit accounted for
-- (transfer_receipts_nonzero requires good+damaged+missing > 0).
with eligible_lines as materialized (
  select tol.transfer_order_id, tol.sellable_sku_id, tol.quantity_requested,
    ts.id as transfer_shipment_id, ts.dispatched_at,
    t.status, t.destination_fulfilment_node_id
  from transfer_order_lines tol
  join transfer_orders t on t.id = tol.transfer_order_id
  join transfer_shipments ts on ts.transfer_order_id = t.id
  where t.status in ('received', 'partially_received')
),
staff_by_node as (
  select fulfilment_node_id, (array_agg(user_id))[1] as user_id
  from staff_memberships group by fulfilment_node_id
),
priced as materialized (
  select el.*, sn.user_id, floor(random() * 100)::int as r
  from eligible_lines el
  join staff_by_node sn on sn.fulfilment_node_id = el.destination_fulfilment_node_id
)
insert into transfer_receipts (transfer_order_id, transfer_shipment_id, sellable_sku_id, quantity_good, quantity_damaged, quantity_missing, received_by, received_at)
select
  transfer_order_id, transfer_shipment_id, sellable_sku_id,
  case
    when status = 'received' and r < 5 then greatest(quantity_requested - 1, 0)
    when status = 'received' then quantity_requested
    else ceil(quantity_requested / 2.0)::int
  end as quantity_good,
  case when status = 'received' and r < 5 then 1 else 0 end as quantity_damaged,
  case when status = 'partially_received' then quantity_requested - ceil(quantity_requested / 2.0)::int else 0 end as quantity_missing,
  user_id, dispatched_at + interval '2 days'
from priced;

-- ============================================================
-- Phase O5: Pricing rules (60, over the 50+ minimum) -- deterministic
-- combinations of source-price-type/currency/margin-type, no random()
-- needed since the values are derived directly from the generate_series
-- index.
-- ============================================================
insert into pricing_rules (organisation_id, name, active, priority, source_price_type, target_currency, margin_type, margin_value)
select
  '58a5ac20-5aa2-43d8-be60-274e9d8de220',
  st || ' ' || cur || ' ' || mt || ' rule ' || n,
  (n % 10 != 0),
  100 - n,
  st, cur, mt,
  case when mt = 'percentage' then 10 + (n % 40) else 0.50 + (n % 20) * 0.25 end
from generate_series(1, 60) n
cross join lateral (select
  (array['market', 'low', 'retail', 'buylist', 'recent_sale'])[1 + (n % 5)] as st,
  (array['AUD', 'USD', 'EUR'])[1 + (n % 3)] as cur,
  (array['percentage', 'flat'])[1 + (n % 2)] as mt
) x;

-- ============================================================
-- Phase O6: calculated_prices + published_prices for a 150,000-SKU
-- sample (50% buffer over the 100,000+ "repricing 100k products"
-- scenario target), using the highest-priority active pricing rule.
-- Values are computed directly via SQL formulas mirroring the real
-- margin/condition/stock modifier components (base + margin + condition
-- + stock, floored at 0) rather than by invoking the actual calculation
-- pipeline at bulk scale, matching how B-210 handled inventory_balances.
-- ============================================================
with the_rule as (
  select id from pricing_rules where active order by priority desc limit 1
),
sku_sample as materialized (
  select id as sellable_sku_id from sellable_skus order by random() limit 150000
),
priced as materialized (
  select
    r.id as pricing_rule_id,
    s.sellable_sku_id,
    round((0.20 + random() * 149.80)::numeric, 2) as base_amount,
    round((0.20 + random() * 20)::numeric, 2) as margin_amount,
    round((-2 + random() * 4)::numeric, 2) as condition_modifier_amount,
    round((-1 + random() * 2)::numeric, 2) as stock_modifier_amount
  from sku_sample s
  cross join the_rule r
)
insert into calculated_prices (
  pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
  margin_amount, condition_modifier_amount, stock_modifier_amount, final_amount,
  currency, status, calculated_at
)
select
  pricing_rule_id, sellable_sku_id, base_amount, 'AUD', 1,
  margin_amount, condition_modifier_amount, stock_modifier_amount,
  greatest(base_amount + margin_amount + condition_modifier_amount + stock_modifier_amount, 0),
  'AUD', 'approved', now()
from priced;

insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency, status)
select '58a5ac20-5aa2-43d8-be60-274e9d8de220', pricing_rule_id, sellable_sku_id, id, final_amount, currency, 'active'
from calculated_prices;
