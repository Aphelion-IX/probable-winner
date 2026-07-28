-- Replaces apps/web's client-side chunked-fetch implementation of the
-- /sets/[code] page's card table (features/catalogue/queries/list-set-cards.ts)
-- with a single database round trip.
--
-- That implementation paged the sellable_skus query (Postgrest's own
-- max_rows=1000 cap) and batched the card_images/published_prices/
-- inventory_balances lookups in groups of 200 ids (Postgrest's gateway
-- rejects a large enough `.in()` list with 400/414 -- see that file's own
-- comment history), all under a concurrency limit. For a large set --
-- Commander Masters (1,067 printings / 8,170 active SKUs), The List (5,045
-- printings / 25,365 active SKUs) -- that adds up to 100-300+ sequential
-- HTTP round trips even at 4-way concurrency: each individual query is fast
-- (a few ms, confirmed via EXPLAIN ANALYZE), but round-trip latency times
-- that many requests is not. This function does the same joins/aggregation
-- in one call.
--
-- Two things mattered for getting this fast, found by testing directly
-- against production before writing this migration:
--
-- 1. A flat join structure, not several CTEs chained through repeated
--    references. The natural way to write this (base CTE -> balances CTE ->
--    prices CTE -> images CTE -> per_sku CTE joining all of them) measured
--    at ~6.9 SECONDS for Commander Masters: Postgres's row-estimation across
--    CTE boundaries badly underestimated cardinality ("rows=2" everywhere in
--    EXPLAIN, actual ~8,170), leading it to pick a nested-loop join for the
--    per-sku price lookup that degenerated into ~12 million comparisons.
--    The equivalent flat query (per-sku correlated subqueries + direct
--    joins, real per-table statistics available to the planner) measured
--    108ms for the same set.
-- 2. work_mem: sorting/grouping 25,000+ rows (The List) spills to disk under
--    the default work_mem, measured at 2.77s; bumping it to 64MB for this
--    function specifically keeps the sort in memory, measured at 307ms.
--
-- security invoker (the default for `language sql`, stated explicitly) --
-- runs as the calling role, so RLS on every underlying table still applies;
-- this is not a bypass, just collapsing many round trips into one.
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
  with params as (
    select
      p_set_code as p_set_code,
      p_in_stock_only as p_in_stock_only,
      p_colors as p_colors,
      p_finishes as p_finishes,
      p_border_colors as p_border_colors,
      p_sort as p_sort
  ),
  per_sku as (
    select
      cp.id as printing_id,
      oc.name,
      oc.type_line,
      oc.colors,
      cp.rarity,
      cp.collector_number,
      f.code as finish_code,
      cp.border_color,
      sk.id as sku_id,
      (
        select coalesce(sum(ib.quantity_available_online), 0)
        from inventory_balances ib
        where ib.sellable_sku_id = sk.id
      ) as available,
      pp.final_amount,
      pp.currency
    from sellable_skus sk
    cross join params p
    join card_printings cp on cp.id = sk.card_printing_id
    join oracle_cards oc on oc.id = cp.oracle_card_id
    join finishes f on f.id = sk.finish_id
    join product_statuses ps on ps.id = sk.product_status_id
    left join published_prices pp on pp.sellable_sku_id = sk.id and pp.status = 'active'
    where cp.set_id = (select id from sets where code = p.p_set_code)
      and ps.code = 'active'
      and (coalesce(array_length(p.p_finishes, 1), 0) = 0 or f.code = any (p.p_finishes))
      and (
        coalesce(array_length(p.p_border_colors, 1), 0) = 0
        or cp.border_color = any (p.p_border_colors)
      )
      and (
        coalesce(array_length(p.p_colors, 1), 0) = 0
        or (
          case
            when oc.colors = '{}'::text[] then 'C' = any (p.p_colors)
            else
              oc.colors
              && (select coalesce(array_agg(c), '{}'::text[]) from unnest(p.p_colors) as c where c <> 'C')
          end
        )
      )
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
      sum(available) as available_quantity,
      (
        select img.url
        from card_images img
        where img.card_printing_id = per_sku.printing_id
          and img.image_type = 'normal'
          and img.face = 'front'
        limit 1
      ) as image_url
    from per_sku
    group by printing_id, finish_code, name, type_line, colors, rarity, collector_number, border_color
  )
  select
    g.printing_id, g.name, g.type_line, g.colors, g.rarity, g.collector_number, g.finish_code,
    g.border_color, g.representative_sku_id, g.price, g.currency, g.available_quantity, g.image_url
  from grouped g
  cross join params p
  where (not p.p_in_stock_only or g.available_quantity > 0)
  order by
    case when p.p_sort = 'price-asc' then g.price end asc nulls last,
    case when p.p_sort = 'price-desc' then g.price end desc nulls last,
    g.name asc,
    g.finish_code asc
  limit p_limit;
$$;

grant execute on function list_set_cards(text, boolean, text[], text[], text[], text, int) to anon, authenticated;
