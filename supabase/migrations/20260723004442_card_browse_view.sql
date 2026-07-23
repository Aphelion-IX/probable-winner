-- Flattened read model for the storefront card-browsing grid: joins
-- card_printings + oracle_cards + sets so the app can filter/sort on plain
-- columns instead of embedding cross-table PostgREST filters. security_invoker
-- means queries against the view are checked against the *querying* role's
-- RLS on the underlying tables (all public-read already), not the view
-- owner's — a view created without this can silently bypass RLS.
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
    s.name as set_name
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id;

grant select on card_browse to anon, authenticated;
