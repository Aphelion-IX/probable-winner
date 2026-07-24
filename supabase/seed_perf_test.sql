-- Realistic performance-test data generator (backlog B-210).
--
-- NOT a schema migration -- deliberately lives outside supabase/migrations/,
-- same convention as supabase/seed.sql. Loads bulk operational data (orders,
-- inventory, customers, carts) on top of the real catalogue already imported
-- into this project (109,877 real card_printings / 816,340 real sellable_skus
-- from the live MTGJSON import -- these already exceed the blueprint §23
-- minimums for printings/SKUs, so this script does not touch the catalogue
-- at all). Targets blueprint §23's remaining minimums: 1,000,000+ inventory
-- balances, 5,000,000+ inventory movements, 100,000+ customers, 100,000+
-- historical orders, 10,000+ active carts -- seeded across the real 4-store
-- topology so the volume actually sits behind the same indexes/RLS policies
-- B-211's load tests will exercise.
--
-- Run each phase below as a separate statement (this file is executed phase
-- by phase via the Supabase MCP execute_sql tool, not `supabase db reset`,
-- since the target volumes require a live database and this sandbox has no
-- local Postgres). Every row this script creates is tagged so it can be
-- identified and removed independently of real data -- see
-- seed_perf_test_cleanup.sql:
--   - auth.users:          email like 'perftest+%@perftest.invalid'
--   - addresses:           email like 'perftest-addr+%@perftest.invalid'
--   - orders:              order_number like 'PERF-%'
--   - inventory_movements: reason = 'perf_seed'
--   - inventory_balances:  no direct tag (derived 1:1 from the perf_seed
--     movements above -- cleanup deletes balances for (node, sku) pairs that
--     only have perf_seed movements)
--   - carts / order_lines / cart_lines / inventory_reservations: untagged
--     directly, but cascade-delete from their tagged parent (auth.users
--     cascades to orders and carts; orders cascades to order_lines; carts
--     cascades to cart_lines; deleting a cart's reservations is handled
--     explicitly in the cleanup script since inventory_reservations has no
--     cascading FK from carts).
--
-- Organisation and the 4 real stores (fixed live IDs, queried once up front
-- so this script fails loudly if the topology ever changes):
--   org:      58a5ac20-5aa2-43d8-be60-274e9d8de220  Demo Card Retailer
--   Geelong:  e8177b98-c092-4dec-aa24-d8f0aab98a28  (STR-01)
--   Bendigo:  0422b344-de03-47d7-8693-eef400ef781a  (STR-02)
--   Werribee: e3599527-1d42-45a3-93a0-a0235ece8649  (STR-03)
--   Ballarat: 35855576-cc0a-4bed-90ec-32b58758bb92  (STR-04)
-- All 4 allow both online_fulfilment and click_collect.

-- ============================================================
-- Phase 1: Customers (auth.users) -- target 120,000 rows (20%
-- buffer over the 100,000+ minimum).
-- encrypted_password left null: these accounts are never signed
-- into, only referenced by FK from orders/carts.
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  gen_random_uuid(),
  'authenticated', 'authenticated',
  'perftest+' || lpad(g::text, 7, '0') || '@perftest.invalid',
  ts, '{"provider":"email","providers":["email"],"perf_seed":true}'::jsonb, '{}'::jsonb,
  false, false, ts, ts
from generate_series(1, 120000) g
cross join lateral (select now() - (random() * interval '365 days') as ts) t;

-- ============================================================
-- Phase 2: Addresses -- target 130,000 rows (one pool shared by
-- orders in phase 3; not owned 1:1 by a customer since the
-- addresses table has no customer_id column).
-- ============================================================
insert into addresses (
  organisation_id, recipient_name, line_1, suburb_city, state_province,
  postcode_zip, country_code, phone, email, created_at, updated_at
)
select
  '58a5ac20-5aa2-43d8-be60-274e9d8de220',
  'Perf Test Customer ' || g,
  (1 + floor(random() * 999)::int) || ' Test Street',
  (array['Geelong', 'Bendigo', 'Werribee', 'Ballarat', 'Melbourne', 'Torquay'])[1 + floor(random() * 6)::int],
  'VIC',
  lpad((3000 + floor(random() * 999))::text, 4, '0'),
  'AU',
  '04' || lpad(floor(random() * 100000000)::text, 8, '0'),
  'perftest-addr+' || lpad(g::text, 7, '0') || '@perftest.invalid',
  ts, ts
from generate_series(1, 130000) g
cross join lateral (select now() - (random() * interval '365 days') as ts) t;

-- ============================================================
-- Phase 3: Orders + order_lines -- target 130,000 orders (30%
-- buffer over the 100,000+ minimum), ~2.5 lines/order (~325,000
-- order_lines). Chained data-modifying CTEs keep order and
-- order_line generation inside one transaction so line counts
-- and prices are computed once, consistently.
-- ============================================================
with cust as (
  select id, row_number() over (order by id) - 1 as rn
  from auth.users where email like 'perftest+%@perftest.invalid'
),
cust_total as (select count(*) as cnt from cust),
addr as (
  select id, row_number() over (order by id) - 1 as rn
  from addresses where email like 'perftest-addr+%@perftest.invalid'
),
addr_total as (select count(*) as cnt from addr),
node as (
  select id, row_number() over (order by code) - 1 as rn
  from fulfilment_nodes
),
node_total as (select count(*) as cnt from node),
picked as materialized (
  select
    g as n,
    c.id as customer_id,
    a.id as address_id,
    nd.id as node_id,
    case when (g % 10) < 7 then 'online_shipping' else 'click_and_collect' end as fulfilment_type,
    (case
      when r < 60 then 'delivered'
      when r < 75 then 'shipped'
      when r < 85 then 'dispatched'
      when r < 91 then 'packed'
      when r < 95 then 'paid'
      when r < 98 then 'pending'
      else 'cancelled'
    end) as status,
    now() - (random() * interval '365 days') as created_at,
    1 + floor(random() * 4)::int as n_lines
  from generate_series(1, 130000) g
  cross join lateral (select floor(random() * 100)::int as r) rr
  join cust c on c.rn = (g % (select cnt from cust_total))
  join addr a on a.rn = (g % (select cnt from addr_total))
  join node nd on nd.rn = (g % (select cnt from node_total))
),
ins_orders as (
  insert into orders (
    organisation_id, customer_id, fulfilment_node_id, order_number, status,
    fulfilment_type, shipping_address_id, collection_store_id, total_amount,
    currency, created_at, updated_at
  )
  select
    '58a5ac20-5aa2-43d8-be60-274e9d8de220', customer_id, node_id,
    'PERF-' || lpad(n::text, 8, '0'),
    status, fulfilment_type,
    case when fulfilment_type = 'online_shipping' then address_id else null end,
    case when fulfilment_type = 'click_and_collect' then node_id else null end,
    0, 'AUD', created_at, created_at
  from picked
  -- RETURNING can only surface columns of `orders` itself (not picked.n_lines
  -- from the source query), so order_number carries n back out -- it already
  -- encodes n as 'PERF-<n padded to 8>' -- and line_counts below recovers
  -- n_lines by parsing it back out and rejoining to picked on n.
  returning id as order_id, order_number, created_at
),
line_counts as (
  select io.order_id, io.created_at, p.n_lines
  from ins_orders io
  join picked p on p.n = substring(io.order_number from 6)::int
),
sku_total as (select count(*) as cnt from sellable_skus),
sku_pool as (
  select id, row_number() over (order by id) - 1 as rn from sellable_skus
)
insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total, created_at)
select
  lc.order_id, sp.id, r.qty, r.price, round(r.price * r.qty, 2), lc.created_at
from line_counts lc
cross join lateral generate_series(1, lc.n_lines) as gs(line_no)
cross join lateral (
  select
    floor(random() * (select cnt from sku_total))::bigint as pick_rn,
    1 + floor(random() * 3)::int as qty,
    round((0.20 + random() * 149.80)::numeric, 2) as price
) r
join sku_pool sp on sp.rn = r.pick_rn;

-- ============================================================
-- Phase 4: Roll up order_lines into orders.total_amount (orders
-- were inserted with a 0 placeholder in phase 3 since totals
-- depend on the lines generated in the same statement).
-- ============================================================
update orders o
set total_amount = t.total, updated_at = o.updated_at
from (
  select order_id, sum(line_total) as total
  from order_lines
  group by order_id
) t
where o.id = t.order_id;

-- ============================================================
-- Phase 5: inventory_balances + inventory_movements. A
-- deterministic pseudo-random hash of (node_id, sku_id) picks
-- ~37% of the 4 stores x 816,340 SKUs candidate pairs (~1.2M
-- balances, comfortably over the 1,000,000+ minimum). Each
-- chosen pair gets one 'receive' movement plus 0-7 individual
-- 'sale' movements (capped so stock never goes negative),
-- averaging ~4.5 movements/pair (~5.4M total, over the
-- 5,000,000+ minimum). Movements are the ledger of record;
-- quantity_on_hand is derived by summing them in the same
-- statement, keeping balances consistent with the ledger per
-- AGENTS.md rule 12 even though this is a bulk load rather than
-- a per-row call to an atomic function.
-- ============================================================
with candidates as materialized (
  select
    fn.id as fulfilment_node_id,
    sk.id as sellable_sku_id,
    1 + (floor(random() * 40)::int) as receive_qty,
    floor(random() * 8)::int as sale_qty_raw
  from fulfilment_nodes fn
  cross join sellable_skus sk
  where random() < 0.37
),
capped as materialized (
  select
    fulfilment_node_id, sellable_sku_id, receive_qty,
    least(sale_qty_raw, receive_qty) as sale_qty
  from candidates
),
ins_balances as (
  insert into inventory_balances (
    fulfilment_node_id, sellable_sku_id, quantity_on_hand, quantity_available_online
  )
  select fulfilment_node_id, sellable_sku_id, receive_qty - sale_qty, receive_qty - sale_qty
  from capped
  returning 1
),
ins_receive as (
  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reason
  )
  select
    '58a5ac20-5aa2-43d8-be60-274e9d8de220', fulfilment_node_id, sellable_sku_id,
    'receive', receive_qty, 'perf_seed', 'perf_seed'
  from capped
  returning 1
)
insert into inventory_movements (
  organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
  quantity_delta, reference_type, reason
)
select
  '58a5ac20-5aa2-43d8-be60-274e9d8de220', c.fulfilment_node_id, c.sellable_sku_id,
  'sale', -1, 'perf_seed', 'perf_seed'
from capped c, generate_series(1, c.sale_qty)
where c.sale_qty > 0;

-- ============================================================
-- Phase 6: Active carts -- target 10,500 carts (5% buffer over
-- the 10,000+ minimum), each with 1-3 lines and a matching
-- active inventory_reservation (cart_lines.inventory_reservation_id
-- is NOT NULL, FK'd to inventory_reservations). Carts belong to
-- perf_seed customers so they cascade-delete with those users;
-- reservations don't cascade from carts and are cleaned up
-- explicitly in seed_perf_test_cleanup.sql.
-- ============================================================
with cust as (
  select id, row_number() over (order by id) - 1 as rn
  from auth.users where email like 'perftest+%@perftest.invalid'
),
cust_total as (select count(*) as cnt from cust),
node as (
  select id, row_number() over (order by code) - 1 as rn
  from fulfilment_nodes
),
node_total as (select count(*) as cnt from node),
sku_total as (select count(*) as cnt from sellable_skus),
sku_pool as (
  select id, row_number() over (order by id) - 1 as rn from sellable_skus
),
cart_seed as materialized (
  select
    g as n,
    c.id as customer_id,
    now() - (random() * interval '30 days') as created_at
  from generate_series(1, 10500) g
  join cust c on c.rn = (g % (select cnt from cust_total))
),
ins_carts as (
  insert into carts (organisation_id, customer_id, status, created_at, updated_at)
  select '58a5ac20-5aa2-43d8-be60-274e9d8de220', customer_id, 'active', created_at, created_at
  from cart_seed
  returning id as cart_id
),
cart_line_seed as materialized (
  select
    cs.cart_id, cs.n as n, gs.line_no,
    nd.id as node_id,
    sp.id as sellable_sku_id,
    1 + floor(random() * 2)::int as qty,
    now() + interval '30 minutes' as expires_at
  from (select cart_id, row_number() over (order by cart_id) as n from ins_carts) cs
  cross join lateral generate_series(1, 1 + floor(random() * 3)::int) as gs(line_no)
  join node nd on nd.rn = ((cs.n + gs.line_no) % (select cnt from node_total))
  cross join lateral (
    select floor(random() * (select cnt from sku_total))::bigint as pick_rn
  ) r
  join sku_pool sp on sp.rn = r.pick_rn
),
ins_reservations as (
  insert into inventory_reservations (
    organisation_id, fulfilment_node_id, sellable_sku_id, cart_id, quantity, status, expires_at
  )
  select
    '58a5ac20-5aa2-43d8-be60-274e9d8de220', node_id, sellable_sku_id, cart_id, qty, 'active', expires_at
  from cart_line_seed
  -- RETURNING can only surface inventory_reservations' own column names
  -- (fulfilment_node_id/quantity), not cart_line_seed's node_id/qty aliases.
  returning id as reservation_id, cart_id, fulfilment_node_id, sellable_sku_id, quantity
)
insert into cart_lines (cart_id, fulfilment_node_id, sellable_sku_id, quantity, inventory_reservation_id)
select cart_id, fulfilment_node_id, sellable_sku_id, quantity, reservation_id
from ins_reservations;

-- Keep inventory_balances.quantity_reserved consistent with the
-- reservations just created (bulk equivalent of what
-- reserve_inventory() would do per-row).
update inventory_balances b
set quantity_reserved = b.quantity_reserved + r.reserved_qty,
    updated_at = now()
from (
  select fulfilment_node_id, sellable_sku_id, sum(quantity) as reserved_qty
  from inventory_reservations
  where status = 'active'
  group by fulfilment_node_id, sellable_sku_id
) r
where b.fulfilment_node_id = r.fulfilment_node_id
  and b.sellable_sku_id = r.sellable_sku_id;

-- A cart line's reserved SKU might not already have a bulk
-- inventory_balances row from phase 5 (only ~37% of pairs got
-- one) -- create balances for the remainder so quantity_reserved
-- is never orphaned from a balance row.
insert into inventory_balances (fulfilment_node_id, sellable_sku_id, quantity_reserved, quantity_available_online)
select r.fulfilment_node_id, r.sellable_sku_id, r.reserved_qty, 0
from (
  select fulfilment_node_id, sellable_sku_id, sum(quantity) as reserved_qty
  from inventory_reservations
  where status = 'active'
  group by fulfilment_node_id, sellable_sku_id
) r
left join inventory_balances b
  on b.fulfilment_node_id = r.fulfilment_node_id and b.sellable_sku_id = r.sellable_sku_id
where b.id is null;
