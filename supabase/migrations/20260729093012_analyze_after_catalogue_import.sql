-- Prevents the class of bug just fixed live: card_printings and
-- sellable_skus had never had ANALYZE run on them despite holding 100K+
-- real rows (pg_stat_user_tables showed n_live_tup=15 and
-- last_analyze/last_autoanalyze=null for both), so Postgres's planner
-- picked catastrophic nested-loop plans for the "view a set with no
-- filters" case (list_set_cards() -- 2.5-38s, timing out in production).
-- Autovacuum's own row-modification counter was equally stale, so it never
-- crossed its own trigger threshold to auto-analyze either.
--
-- import_set_and_promote() (cron-scheduled every minute, see
-- 20260723133205_catalogue_import_edge_function_cron.sql) is the live
-- catalogue-import path and the only thing that grows these tables in
-- production going forward. It previously never ran ANALYZE after writing
-- a set's cards -- relying entirely on autovacuum eventually catching up,
-- which is exactly what didn't happen. Running ANALYZE explicitly after a
-- successful import guarantees these tables' statistics stay correct
-- regardless of whether autovacuum's own bookkeeping keeps up, at the cost
-- of one cheap statistics sample (not a full scan) per set processed.
--
-- Re-declares `set search_path = public` inline (rather than relying on
-- CREATE OR REPLACE to preserve the ALTER FUNCTION ... SET search_path
-- applied in 20260725050000_fix_search_path_and_security_definer_view.sql)
-- so this replace can't accidentally regress that fix.
create or replace function import_set_and_promote(
  p_set_code text,
  p_set_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  begin
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

    -- Keep planner statistics for the tables this loop just wrote to
    -- correct on every successful import, rather than depending on
    -- autovacuum's own (previously-stale) bookkeeping.
    analyze card_printings;
    analyze sellable_skus;
    analyze oracle_cards;
    analyze card_identifiers;

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
    update catalogue_import_runs
    set status = 'failed', completed_at = now()
    where id = v_run_id;

    insert into catalogue_import_errors (
      catalogue_import_run_id, severity, message, context
    ) values (v_run_id, 'error', sqlerrm, jsonb_build_object('setCode', p_set_code));

    return jsonb_build_object(
      'runId', v_run_id,
      'status', 'failed',
      'error', sqlerrm
    );
  end;
end;
$$;
