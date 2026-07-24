-- Surfaces the set's Scryfall-hosted expansion-icon URL (backfilled by
-- apps/worker's import-set-symbols job into sets.icon_url, a column that
-- already existed but was never populated) on the browse grid, alongside
-- the card image added in 20260725010000.
--
-- This inserts set_icon_url before the trailing image_url column added by
-- 20260725010000_card_browse_image_url.sql -- not a pure trailing append,
-- so `create or replace view` is rejected ("cannot change name of view
-- column 'image_url' to 'set_icon_url'"); Postgres only allows appending
-- new columns at the end. Drop and recreate instead (verified no
-- dependents via pg_depend before this was first applied).
drop view if exists card_browse;

create view card_browse
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
    s.icon_url as set_icon_url,
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
