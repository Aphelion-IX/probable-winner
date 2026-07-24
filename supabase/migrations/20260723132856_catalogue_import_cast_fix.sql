-- RECONCILIATION NOTE: pulled verbatim from the live project's migration
-- history (see 20260723064823_fix_transfer_status_transitions.sql for why).

-- Fix: several columns are typed uuid/bigint/numeric but the JSONB text
-- extraction (->>) always yields text, and PL/pgSQL does not auto-cast
-- text into uuid/bigint for an INSERT target. Add explicit casts, and
-- guard against empty-string values (MTGJSON omits some identifier
-- fields for certain cards) which would fail a uuid/bigint cast.

create or replace function process_catalogue_card(
  p_game_id uuid,
  p_set_id uuid,
  p_run_id uuid,
  p_card jsonb
)
returns void as $$
declare
  v_oracle_card_id uuid;
  v_printing_id uuid;
  v_artist_id uuid;
  v_scryfall_oracle_id uuid;
begin
  v_scryfall_oracle_id := nullif(p_card->'identifiers'->>'scryfallOracleId', '')::uuid;

  insert into oracle_cards (
    game_id, scryfall_oracle_id, name, mana_cost, cmc,
    type_line, oracle_text, power, toughness, loyalty, colors, color_identity
  )
  values (
    p_game_id,
    v_scryfall_oracle_id,
    p_card->>'name',
    p_card->>'manaCost',
    (p_card->>'manaValue')::numeric,
    p_card->>'type',
    p_card->>'text',
    p_card->>'power',
    p_card->>'toughness',
    p_card->>'loyalty',
    (select array_agg(val) from jsonb_array_elements_text(p_card->'colors') as val),
    (select array_agg(val) from jsonb_array_elements_text(p_card->'colorIdentity') as val)
  )
  on conflict (game_id, scryfall_oracle_id) do update set updated_at = now()
  returning id into v_oracle_card_id;

  if p_card->>'artist' is not null then
    insert into artists (name)
    values (p_card->>'artist')
    on conflict (name) do nothing;
    select id into v_artist_id from artists where name = p_card->>'artist';
  end if;

  insert into card_printings (
    oracle_card_id, set_id, artist_id, collector_number, rarity,
    finishes, frame, border_color, flavor_text, is_promo, is_variation, released_at
  )
  values (
    v_oracle_card_id,
    p_set_id,
    v_artist_id,
    p_card->>'number',
    p_card->>'rarity',
    (select array_agg(val) from jsonb_array_elements_text(p_card->'finishes') as val),
    p_card->>'frameVersion',
    p_card->>'borderColor',
    p_card->>'flavorText',
    coalesce((p_card->>'isPromo')::boolean, false),
    coalesce((p_card->>'isAlternative')::boolean, false),
    now()
  )
  on conflict (set_id, collector_number) do update set updated_at = now()
  returning id into v_printing_id;

  insert into card_identifiers (
    card_printing_id, mtgjson_uuid, scryfall_id, tcgplayer_product_id, cardmarket_id
  )
  values (
    v_printing_id,
    nullif(p_card->>'uuid', '')::uuid,
    nullif(p_card->'identifiers'->>'scryfallId', '')::uuid,
    nullif(p_card->'identifiers'->>'tcgplayerProductId', '')::bigint,
    nullif(p_card->'identifiers'->>'mcmId', '')::bigint
  )
  on conflict (card_printing_id) do update set
    mtgjson_uuid = excluded.mtgjson_uuid,
    scryfall_id = excluded.scryfall_id,
    tcgplayer_product_id = excluded.tcgplayer_product_id,
    cardmarket_id = excluded.cardmarket_id;

  insert into sellable_skus (
    card_printing_id, language_id, finish_id, condition_id, product_status_id
  )
  select
    v_printing_id,
    (select id from languages where code = 'en'),
    f.id,
    c.id,
    (select id from product_statuses where code = 'active')
  from finishes f
  cross join conditions c
  where f.code = any(
    select jsonb_array_elements_text(p_card->'finishes')
  )
  on conflict (card_printing_id, language_id, finish_id, condition_id) do nothing;

end;
$$ language plpgsql security definer;
