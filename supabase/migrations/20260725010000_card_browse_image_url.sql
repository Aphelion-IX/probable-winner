-- The browse grid (apps/web/src/app/(storefront)/cards/page.tsx) has
-- always been able to render a card's image (CardTile takes an imageSrc
-- prop) but card_browse never exposed one, so every tile rendered the
-- "no image available" placeholder. Add the front-face "normal" image URL
-- (blueprint's recommended size for deck grids/collection pages) as a
-- scalar subquery column -- a plain `create or replace view` with a new
-- trailing column is safe; it doesn't change any existing column's
-- position or type.
create or replace view card_browse
  with (security_invoker = true)
  as
  select
    cp.id as printing_id,
    oc.id as oracle_card_id,
    oc.name,
    oc.type_line,
    oc.colors,
    oc.color_identity,
    cp.collector_number,
    cp.rarity,
    cp.finishes,
    cp.released_at,
    s.code as set_code,
    s.name as set_name,
    (
      select ci.url
      from card_images ci
      where ci.card_printing_id = cp.id
        and ci.image_type = 'normal'
        and ci.face = 'front'
      limit 1
    ) as image_url
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id;

grant select on card_browse to anon, authenticated;
