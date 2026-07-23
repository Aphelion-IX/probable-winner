-- RECONCILIATION NOTE: pulled verbatim from the live project's migration
-- history (see 20260723064823_fix_transfer_status_transitions.sql for why).

-- Fix: catalogue_import_runs.status CHECK constraint only allows
-- 'running' | 'succeeded' | 'failed' | 'partial' — not 'in_progress'.
-- The original in_progress value caused the initial insert to fail the
-- CHECK constraint, which left v_run_id NULL and masked the real error
-- behind a NOT NULL violation in the exception handler.

create or replace function import_set_and_promote(
  p_set_code text,
  p_set_data jsonb
)
returns jsonb as $$
declare
  v_game_id uuid;
  v_run_id uuid;
  v_set_id uuid;
  v_printings_upserted int := 0;
  v_skus_inserted int := 0;
begin
  select id into v_game_id from games where code = 'mtg';
  if not found then
    raise exception 'Game mtg not found';
  end if;

  insert into catalogue_import_runs (game_id, source, source_ref, status)
  values (v_game_id, 'mtgjson', 'set:' || p_set_code, 'running')
  on conflict (game_id, source, source_ref) do update
    set status = 'running', started_at = now()
  returning id into v_run_id;

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

  perform process_catalogue_card(v_game_id, v_set_id, v_run_id, card_obj)
  from (
    select jsonb_array_elements(p_set_data->'cards') as card_obj
  ) as cards;

  select count(*)::int into v_printings_upserted
  from card_printings
  where set_id = v_set_id;

  select count(*)::int into v_skus_inserted
  from sellable_skus
  where card_printing_id in (select id from card_printings where set_id = v_set_id);

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
  if v_run_id is not null then
    update catalogue_import_runs
    set status = 'failed', completed_at = now()
    where id = v_run_id;

    insert into catalogue_import_errors (
      catalogue_import_run_id, severity, message, context
    ) values (v_run_id, 'error', sqlerrm, jsonb_build_object('setCode', p_set_code));
  end if;

  raise;
end;
$$ language plpgsql security definer;
