-- Replaces get-sku-live-data.ts's 3 separate PostgREST requests (sellable_skus,
-- published_prices, inventory_balances -- already run concurrently via
-- Promise.all, so this isn't the sequential round-trip amplification bug
-- fixed for list_set_cards/list_popular_cards) with a single database round
-- trip. This is the single highest-frequency catalogue query in the app --
-- apps/web/src/app/api/sellable-skus/[id]/route.ts backs the product page's
-- live price/stock section (blueprint §14 "volatile" section) and every
-- condition/finish switch a shopper makes calls it again.
--
-- Each individual query was already fast and properly indexed (confirmed via
-- EXPLAIN ANALYZE against production: sub-millisecond, using
-- sellable_skus_pkey / published_prices_sku_idx /
-- inventory_balances_sellable_sku_id_idx) -- there was no missing-index
-- problem here like card_printings.released_at. The win is purely fewer
-- HTTP round trips: 3 concurrent PostgREST requests collapsed into 1.
--
-- Deliberately NOT cached (no unstable_cache wrapper in the TS caller, no
-- revalidate here) -- price and availability are the one place in this
-- session's work that must stay live on every single call, per blueprint
-- §14's stable-shell/volatile-section split.
--
-- security invoker (the default for `language sql`, stated explicitly) --
-- runs as the calling role, so RLS on every underlying table still applies.
create or replace function get_sku_live_data(p_sku_id uuid)
returns table (
  sku_id uuid,
  price numeric,
  currency text,
  available_quantity bigint
)
language sql
stable
security invoker
as $$
  select
    sk.id as sku_id,
    pp.final_amount as price,
    pp.currency as currency,
    (
      select coalesce(sum(ib.quantity_available_online), 0)
      from inventory_balances ib
      where ib.sellable_sku_id = sk.id
    ) as available_quantity
  from sellable_skus sk
  left join lateral (
    select p.final_amount, p.currency
    from published_prices p
    where p.sellable_sku_id = sk.id and p.status = 'active'
    limit 1
  ) pp on true
  where sk.id = p_sku_id;
$$;

grant execute on function get_sku_live_data(uuid) to anon, authenticated;
