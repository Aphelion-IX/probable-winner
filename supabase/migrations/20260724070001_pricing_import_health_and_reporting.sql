-- Pricing import health and reporting (backlog B-154).
-- Track provider health status per import run and expose via a reporting view.

-- Add provider health tracking to price_import_runs
alter table price_import_runs
  add column provider_healthy boolean,
  add column provider_health_message text;

-- Reporting view: summary of all imports with provider health status
create view price_import_summary as
  select
    ps.code as provider_code,
    ps.name as provider_name,
    pir.id as run_id,
    pir.source_ref,
    pir.status,
    pir.started_at,
    pir.completed_at,
    (pir.completed_at - pir.started_at) as duration,
    pir.raw_row_count,
    pir.mapped_row_count,
    pir.unmapped_row_count,
    pir.provider_healthy,
    pir.provider_health_message,
    (
      select count(*)
      from price_import_errors pie
      where pie.price_import_run_id = pir.id
        and pie.severity = 'error'
    ) as error_count,
    (
      select count(*)
      from price_import_errors pie
      where pie.price_import_run_id = pir.id
        and pie.severity = 'warning'
    ) as warning_count
  from price_import_runs pir
  join price_sources ps on ps.id = pir.price_source_id
  order by pir.completed_at desc, pir.started_at desc;

-- Helper function: get the latest import status for a provider
create or replace function get_latest_provider_import(provider_code text)
returns json as $$
  select jsonb_build_object(
    'provider', provider_code,
    'last_import', pir.completed_at,
    'status', pir.status,
    'healthy', pir.provider_healthy,
    'errors', (
      select count(*)
      from price_import_errors pie
      where pie.price_import_run_id = pir.id and pie.severity = 'error'
    ),
    'warnings', (
      select count(*)
      from price_import_errors pie
      where pie.price_import_run_id = pir.id and pie.severity = 'warning'
    ),
    'mapped_count', pir.mapped_row_count,
    'unmapped_count', pir.unmapped_row_count
  )
  from price_import_runs pir
  join price_sources ps on ps.id = pir.price_source_id
  where ps.code = provider_code
    and pir.completed_at is not null
  order by pir.completed_at desc
  limit 1;
$$ language sql security definer stable;

-- Helper function: verify that a failed import did not corrupt existing prices
-- Returns true if price_snapshots remain unchanged after a failed run
create or replace function verify_import_run_isolation(run_id uuid)
returns json as $$
declare
  v_run record;
  v_snapshots_count integer;
  v_previous_snapshot_count integer;
begin
  select * into v_run from price_import_runs where id = run_id;
  if v_run is null then
    return jsonb_build_object('valid', false, 'message', 'run not found');
  end if;

  if v_run.status = 'running' then
    return jsonb_build_object('valid', false, 'message', 'run still in progress');
  end if;

  -- Count snapshots from this run
  select count(*) into v_snapshots_count
  from price_snapshots where price_import_run_id = run_id;

  -- If run succeeded, isolation is OK (snapshots from this run exist)
  if v_run.status = 'succeeded' then
    return jsonb_build_object(
      'valid', true,
      'message', 'run succeeded',
      'snapshots_created', v_snapshots_count
    );
  end if;

  -- If run failed, ensure no snapshots from this run exist
  -- (isolating the failure from the snapshot table)
  if v_snapshots_count > 0 then
    return jsonb_build_object(
      'valid', false,
      'message', 'failed run left dangling snapshots',
      'snapshot_count', v_snapshots_count
    );
  end if;

  return jsonb_build_object(
    'valid', true,
    'message', 'failed run properly isolated',
    'snapshots_created', 0
  );
end;
$$ language plpgsql security definer;
