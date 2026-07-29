-- Fixes /sets/[code] failing to load for large sets.
--
-- Symptom: "Failed to list set cards: canceling statement due to statement
-- timeout" on /sets/[code] in production. The storefront reads the catalogue
-- with the anon key, and Supabase sets `statement_timeout = 3s` on the anon
-- role, so every set whose list_set_cards() call ran longer than that
-- rendered an error instead of a card table. Measured against production as
-- the anon role, before this migration:
--
--   set                     active SKUs   in-stock view
--   Commander Masters (CMM)       8,170       2.9s   (over budget)
--   Doctor Who (WHO)              8,650       4.3s   (over budget)
--   Final Fantasy (FIN)           5,610       3.7s   (over budget)
--   The List (PLST)              25,365      11.0s   (over budget)
--
-- Small sets stayed under 3s, which is why only *some* set pages broke.
--
-- The original function's timings (108ms for CMM, 307ms for The List, quoted
-- in 20260728230342_list_set_cards_function.sql) were taken as a superuser
-- against a warm cache. Two things make the real storefront path much more
-- expensive than that measurement suggested:
--
--   1. RLS. The function is `security invoker`, so as anon every
--      inventory_balances row read re-checks the fulfilment-node policy and
--      every published_prices row re-checks the org policy. A superuser
--      bypasses all of it.
--   2. Cache pressure. shared_buffers is 256MB; the CMM query touched
--      ~112,000 buffers (~875MB), so it evicted its own working set and ran
--      cold every time -- 4.2s even on a repeat run.
--
-- Three changes, each measured as the anon role against production:
--
-- 1. Two partial indexes matching what this page actually reads. Only 7,711
--    of 1,209,211 inventory_balances rows have stock, and only 150,015 of
--    816,355 SKUs have an active price, but the lookups went through the
--    all-rows indexes and fetched heap tuples for every SKU in the set.
--    Restricted to the rows the storefront wants, and with the read columns
--    INCLUDEd (plus the columns the RLS policies test, so the policy check
--    doesn't force a heap fetch of its own), both become index-only scans
--    with ~0 heap fetches. The inventory index is 464kB and the price index
--    11MB, so both stay resident instead of thrashing shared_buffers.
--
-- 2. Join oracle_cards at the printing level instead of the SKU level. Name
--    and type line are properties of the printing, but the old query looked
--    them up once per SKU: 8,170 index probes for CMM's 1,067 printings
--    (24,520 buffers -> 3,203).
--
-- 3. Look the card image up after the LIMIT, not before. The old query ran
--    the card_images subquery for all 1,634 of CMM's printing+finish groups
--    and then returned 200 of them.
--
-- The stock lookup also moves from a correlated subquery to a LATERAL join:
-- referencing `sum((subquery))` in both the select list and the in-stock
-- filter made the planner evaluate the whole subplan twice (it appeared as
-- two separate 16,000-buffer SubPlans in EXPLAIN).
--
-- Result for CMM's in-stock view as anon: 2.9s -> 120ms, ~112,000 buffers ->
-- ~65,000, all cache hits.
--
-- Behaviour is unchanged: same columns, same grouping, same
-- cheapest-SKU-is-representative rule, same sort and limit semantics.
-- Adding `quantity_available_online > 0` to the stock lookup is what lets
-- the partial index apply, and it cannot change the sum -- the column has a
-- `CHECK (quantity_available_online >= 0)` constraint, so the rows it skips
-- are exactly the rows that contribute zero.

create index if not exists inventory_balances_available_online_idx
  on public.inventory_balances (sellable_sku_id)
  include (quantity_available_online, fulfilment_node_id)
  where quantity_available_online > 0;

create index if not exists published_prices_active_sku_idx
  on public.published_prices (sellable_sku_id)
  include (final_amount, currency, status, organisation_id)
  where status = 'active';

create or replace function list_set_cards(
  p_set_code text,
  p_in_stock_only boolean default false,
  p_colors text[] default null,
  p_finishes text[] default null,
  p_border_colors text[] default null,
  p_sort text default 'name-asc',
  p_limit int default 200
)
returns table (
  printing_id uuid,
  name text,
  type_line text,
  colors text[],
  rarity text,
  collector_number text,
  finish_code text,
  border_color text,
  representative_sku_id uuid,
  price numeric,
  currency text,
  available_quantity bigint,
  image_url text
)
language sql
stable
security invoker
set work_mem = '64MB'
as $$
  -- Still a flat join structure rather than CTEs chained through repeated
  -- references, for the reason 20260728230342 found the hard way: a
  -- multiply-referenced CTE is materialised, the planner loses the
  -- underlying table statistics across that boundary, and the resulting
  -- nested loops degenerate. Every CTE here is referenced exactly once, so
  -- all of them inline and the planner keeps real per-table statistics.
  with pr as (
    -- Printing-level attributes, resolved once per printing. The colour and
    -- treatment filters belong here too: both are printing/oracle
    -- properties, so applying them before the fan-out to SKUs means a
    -- filtered view never expands rows it is about to discard.
    select
      cp.id as printing_id,
      cp.rarity,
      cp.collector_number,
      cp.border_color,
      oc.name,
      oc.type_line,
      oc.colors
    from card_printings cp
    join oracle_cards oc on oc.id = cp.oracle_card_id
    where cp.set_id = (select id from sets where code = p_set_code)
      and (
        coalesce(array_length(p_border_colors, 1), 0) = 0
        or cp.border_color = any (p_border_colors)
      )
      and (
        coalesce(array_length(p_colors, 1), 0) = 0
        or (
          case
            when oc.colors = '{}'::text[] then 'C' = any (p_colors)
            else
              oc.colors
              && (select coalesce(array_agg(c), '{}'::text[]) from unnest(p_colors) as c where c <> 'C')
          end
        )
      )
  ),
  per_sku as (
    select
      pr.printing_id,
      pr.name,
      pr.type_line,
      pr.colors,
      pr.rarity,
      pr.collector_number,
      pr.border_color,
      f.code as finish_code,
      sk.id as sku_id,
      stock.available,
      pp.final_amount,
      pp.currency
    from pr
    join sellable_skus sk on sk.card_printing_id = pr.printing_id
    join finishes f on f.id = sk.finish_id
    join product_statuses ps on ps.id = sk.product_status_id
    left join lateral (
      select coalesce(sum(ib.quantity_available_online), 0) as available
      from inventory_balances ib
      where ib.sellable_sku_id = sk.id
        and ib.quantity_available_online > 0
    ) stock on true
    left join published_prices pp on pp.sellable_sku_id = sk.id and pp.status = 'active'
    where ps.code = 'active'
      and (coalesce(array_length(p_finishes, 1), 0) = 0 or f.code = any (p_finishes))
  ),
  grouped as (
    select
      printing_id,
      finish_code,
      name,
      type_line,
      colors,
      rarity,
      collector_number,
      border_color,
      (array_agg(sku_id order by final_amount asc nulls last, sku_id))[1] as representative_sku_id,
      (array_agg(final_amount order by final_amount asc nulls last, sku_id))[1] as price,
      (array_agg(currency order by final_amount asc nulls last, sku_id))[1] as currency,
      sum(available) as available_quantity
    from per_sku
    group by printing_id, finish_code, name, type_line, colors, rarity, collector_number, border_color
  ),
  page as (
    -- Cut to the returned page before the image lookup below.
    select g.*
    from grouped g
    where (not p_in_stock_only or g.available_quantity > 0)
    order by
      case when p_sort = 'price-asc' then g.price end asc nulls last,
      case when p_sort = 'price-desc' then g.price end desc nulls last,
      g.name asc,
      g.finish_code asc
    limit p_limit
  )
  select
    g.printing_id, g.name, g.type_line, g.colors, g.rarity, g.collector_number, g.finish_code,
    g.border_color, g.representative_sku_id, g.price, g.currency, g.available_quantity,
    (
      select img.url
      from card_images img
      where img.card_printing_id = g.printing_id
        and img.image_type = 'normal'
        and img.face = 'front'
      limit 1
    ) as image_url
  from page g
  order by
    case when p_sort = 'price-asc' then g.price end asc nulls last,
    case when p_sort = 'price-desc' then g.price end desc nulls last,
    g.name asc,
    g.finish_code asc;
$$;

grant execute on function list_set_cards(text, boolean, text[], text[], text[], text, int) to anon, authenticated;
