-- Stored procedure to handle catalogue import from Edge Function
-- Receives MTGJSON set data and performs full import+promote+SKU generation

create or replace function import_set_and_promote(
  p_set_code text,
  p_set_data jsonb
)
returns jsonb as $$
declare
  v_game_id uuid;
  v_run_id uuid;
  v_set_id uuid;
  v_set_size int;
  v_cards_count int;
  v_printings_upserted int := 0;
  v_skus_inserted int := 0;
begin
  -- Get game
  select id into v_game_id from games where code = 'mtg';
  if not found then
    raise exception 'Game mtg not found';
  end if;

  -- Create import run
  insert into catalogue_import_runs (game_id, source, source_ref, status)
  values (v_game_id, 'mtgjson', 'set:' || p_set_code, 'in_progress')
  on conflict (game_id, source, source_ref) do update
    set status = 'in_progress', started_at = now()
  returning id into v_run_id;

  -- Insert set
  insert into sets (
    game_id, code, name, set_type, released_at, card_count
  )
  values (
    v_game_id,
    (p_set_data->>'code'),
    (p_set_data->>'name'),
    (p_set_data->>'type'),
    ((p_set_data->>'releaseDate')::date),
    jsonb_array_length(p_set_data->'cards')
  )
  on conflict (game_id, code) do update set
    name = excluded.name,
    set_type = excluded.set_type,
    released_at = excluded.released_at,
    card_count = excluded.card_count,
    updated_at = now()
  returning id into v_set_id;

  -- Process each card and generate SKUs
  perform process_catalogue_card(v_game_id, v_set_id, v_run_id, card_obj)
  from (
    select jsonb_array_elements(p_set_data->'cards') as card_obj
  ) as cards;

  -- Count printings created
  select count(*)::int into v_printings_upserted
  from card_printings
  where set_id = v_set_id;

  -- Count SKUs created
  select count(*)::int into v_skus_inserted
  from sellable_skus
  where card_printing_id in (select id from card_printings where set_id = v_set_id);

  -- Mark run as succeeded
  update catalogue_import_runs
  set status = 'succeeded', completed_at = now(),
      sets_processed = 1, cards_processed = v_printings_upserted
  where id = v_run_id;

  return jsonb_build_object(
    'runId', v_run_id,
    'status', 'succeeded',
    'printingsUpserted', v_printings_upserted,
    'skusInserted', v_skus_inserted
  );

exception when others then
  -- Mark run as failed
  update catalogue_import_runs
  set status = 'failed', completed_at = now()
  where id = v_run_id;

  insert into catalogue_import_errors (
    catalogue_import_run_id, severity, message, context
  ) values (v_run_id, 'error', sqlerrm, jsonb_build_object('setCode', p_set_code));

  raise;
end;
$$ language plpgsql security definer;

-- Helper function to process a single card
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
  v_scryfall_oracle_id text;
begin
  v_scryfall_oracle_id := (p_card->>'identifiers')::jsonb->>'scryfallOracleId';

  -- Insert or get oracle card
  insert into oracle_cards (
    game_id, scryfall_oracle_id, name, mana_cost, cmc,
    type_line, oracle_text, power, toughness, loyalty, colors, color_identity
  )
  values (
    p_game_id,
    v_scryfall_oracle_id,
    p_card->>'name',
    p_card->>'manaCost',
    (p_card->>'manaValue')::int,
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

  -- Get artist ID if exists
  if p_card->>'artist' is not null then
    insert into artists (name)
    values (p_card->>'artist')
    on conflict (name) do nothing
    returning id into v_artist_id;
    select id into v_artist_id from artists where name = p_card->>'artist';
  end if;

  -- Insert printing
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
    (p_card->>'isPromo')::boolean,
    (p_card->>'isAlternative')::boolean,
    now()
  )
  on conflict (set_id, collector_number) do update set updated_at = now()
  returning id into v_printing_id;

  -- Store card identifiers
  insert into card_identifiers (
    card_printing_id, mtgjson_uuid, scryfall_id, tcgplayer_product_id, cardmarket_id
  )
  values (
    v_printing_id,
    p_card->>'uuid',
    (p_card->'identifiers'->>'scryfallId'),
    (p_card->'identifiers'->>'tcgplayerProductId'),
    (p_card->'identifiers'->>'mcmId')
  )
  on conflict (card_printing_id) do update set
    mtgjson_uuid = excluded.mtgjson_uuid,
    scryfall_id = excluded.scryfall_id,
    tcgplayer_product_id = excluded.tcgplayer_product_id,
    cardmarket_id = excluded.cardmarket_id;

  -- Generate SKUs for this printing
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
