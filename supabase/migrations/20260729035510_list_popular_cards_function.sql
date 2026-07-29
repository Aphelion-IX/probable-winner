-- Replaces apps/web's list-popular-cards.ts client-side 3-round-trip
-- implementation of the homepage "Popular right now" rail (card_browse ->
-- sellable_skus -> published_prices) with a single database round trip,
-- same pattern as list_set_cards() (20260728230342_list_set_cards_function.sql).
--
-- The real cost here wasn't the round trips, though -- it was
-- card_printings having no index on released_at at all: card_browse's
-- `order by released_at desc limit 6` forced a full sequential scan and
-- sort of all 109,892 card_printings rows on every homepage load, measured
-- at 143.6ms via EXPLAIN ANALYZE. Adding the index below lets Postgres
-- satisfy that order/limit with an index scan instead -- measured at 2.6ms
-- for the identical query, a ~55x improvement. The round-trip collapse
-- matters far less at this scale (6 rows), but is still one fewer hop.
create index if not exists card_printings_released_at_idx
on card_printings (released_at desc nulls last);

-- security invoker (the default for `language sql`, stated explicitly) --
-- runs as the calling role, so RLS on every underlying table still applies.
-- card_browse's own view definition already runs security invoker (see
-- 20260725050000_fix_search_path_and_security_definer_view.sql), and
-- card_printings/oracle_cards/sets/sellable_skus are all `using (true)`
-- anon/authenticated read policies; published_prices' own public policy
-- only checks `status = 'active'` -- never a session or customer id.
--
-- The price subquery picks an arbitrary active price per printing (ordered
-- by sku id, price id for a reproducible result), matching the original
-- TypeScript's own "first active published price" semantics -- this rail
-- is at-a-glance pricing, not the authoritative per-condition price shown
-- on a set/product page.
create or replace function list_popular_cards(p_limit int default 6)
returns table (
  printing_id uuid,
  oracle_card_id uuid,
  name text,
  type_line text,
  colors text[],
  color_identity text[],
  collector_number text,
  rarity text,
  finishes text[],
  released_at date,
  set_code text,
  set_name text,
  set_icon_url text,
  image_url text,
  price numeric
)
language sql
stable
security invoker
as $$
  select
    cb.printing_id,
    cb.oracle_card_id,
    cb.name,
    cb.type_line,
    cb.colors,
    cb.color_identity,
    cb.collector_number,
    cb.rarity,
    cb.finishes,
    cb.released_at,
    cb.set_code,
    cb.set_name,
    cb.set_icon_url,
    cb.image_url,
    (
      select pp.final_amount
      from sellable_skus sk
      join published_prices pp
        on pp.sellable_sku_id = sk.id and pp.status = 'active'
      where sk.card_printing_id = cb.printing_id
      order by sk.id, pp.id
      limit 1
    ) as price
  from card_browse cb
  order by cb.released_at desc nulls last
  limit p_limit;
$$;

grant execute on function list_popular_cards(int) to anon, authenticated;
