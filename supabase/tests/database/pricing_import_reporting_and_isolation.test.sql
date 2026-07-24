-- pgTAP tests for price_import_summary / get_latest_provider_import() /
-- verify_import_run_isolation() (backlog B-154/B-155). Run via
-- `supabase test db` once the local Supabase CLI/Docker stack is
-- available -- wrapped in BEGIN/ROLLBACK so no fixture data is left
-- behind. All fixture rows and assertions run under the initial
-- (superuser) connection role: price_sources/price_import_runs/
-- price_import_errors/price_snapshots have SELECT-only RLS policies for
-- 'authenticated' (the app never writes them directly -- only the worker,
-- via a service-role/direct-Postgres connection, does), so there's no
-- staff role to switch into for these assertions.
begin;

select plan(5);

create temp table test_ids_pir (key text primary key, id uuid);

with src as (
  insert into price_sources (code, name)
  values ('pir_test_provider', 'PIR Test Provider')
  returning id
)
insert into test_ids_pir (key, id) select 'source', id from src;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'pirt', 'PIR Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000000f01', 'PIR Test Card', 'Instant' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil']
       from oc, s
       returning id
     )
insert into test_ids_pir (key, id) select 'card_printing', id from cp;

-- B-154: a succeeded run with recorded errors/warnings should roll up
-- correctly in price_import_summary and get_latest_provider_import().
with r as (
  insert into price_import_runs (
    price_source_id, source_ref, status, started_at, completed_at,
    raw_row_count, mapped_row_count, unmapped_row_count,
    provider_healthy, provider_health_message
  )
  select
    (select id from test_ids_pir where key = 'source'), 'pir-run-1', 'succeeded',
    now() - interval '5 minutes', now(),
    10, 8, 2, true, null
  returning id
)
insert into test_ids_pir (key, id) select 'run_succeeded', id from r;

insert into price_import_errors (price_import_run_id, severity, message)
values
  ((select id from test_ids_pir where key = 'run_succeeded'), 'error', 'card X could not be mapped'),
  ((select id from test_ids_pir where key = 'run_succeeded'), 'warning', 'card Y matched with low confidence');

select ok(
  (
    select error_count = 1 and warning_count = 1
      and raw_row_count = 10 and mapped_row_count = 8 and unmapped_row_count = 2
      and provider_healthy = true
    from price_import_summary
    where run_id = (select id from test_ids_pir where key = 'run_succeeded')
  ),
  'price_import_summary rolls up row counts and per-severity error/warning counts for a run'
);

select ok(
  (
    select
      (get_latest_provider_import('pir_test_provider')->>'status') = 'succeeded'
      and (get_latest_provider_import('pir_test_provider')->>'mapped_count')::int = 8
      and (get_latest_provider_import('pir_test_provider')->>'unmapped_count')::int = 2
      and (get_latest_provider_import('pir_test_provider')->>'errors')::int = 1
      and (get_latest_provider_import('pir_test_provider')->>'warnings')::int = 1
  ),
  'get_latest_provider_import returns the latest completed run''s status and counts'
);

-- B-155: a failed run that inserted no price_snapshots is properly isolated.
with r as (
  insert into price_import_runs (price_source_id, source_ref, status, started_at, completed_at)
  select (select id from test_ids_pir where key = 'source'), 'pir-run-2-clean-failure', 'failed',
    now() - interval '5 minutes', now()
  returning id
)
insert into test_ids_pir (key, id) select 'run_failed_clean', id from r;

select ok(
  (
    select (verify_import_run_isolation((select id from test_ids_pir where key = 'run_failed_clean'))->>'valid')::boolean = true
      and (verify_import_run_isolation((select id from test_ids_pir where key = 'run_failed_clean'))->>'snapshots_created')::int = 0
  ),
  'verify_import_run_isolation reports a cleanly-failed run (no snapshots) as valid'
);

-- B-155: a failed run that somehow left dangling snapshots must be flagged
-- invalid -- proving the check actually detects corruption, not just
-- always returning true.
with r as (
  insert into price_import_runs (price_source_id, source_ref, status, started_at, completed_at)
  select (select id from test_ids_pir where key = 'source'), 'pir-run-3-corrupted-failure', 'failed',
    now() - interval '5 minutes', now()
  returning id
)
insert into test_ids_pir (key, id) select 'run_failed_corrupted', id from r;

insert into price_snapshots (
  price_import_run_id, price_source_id, provider, source_product_id,
  card_printing_id, language, finish, price_type, amount, currency, observed_at
)
values (
  (select id from test_ids_pir where key = 'run_failed_corrupted'),
  (select id from test_ids_pir where key = 'source'),
  'pir_test_provider', 'ext-1',
  (select id from test_ids_pir where key = 'card_printing'),
  'en', 'normal', 'retail', 1.23, 'USD', now()
);

select ok(
  (
    select (verify_import_run_isolation((select id from test_ids_pir where key = 'run_failed_corrupted'))->>'valid')::boolean = false
      and (verify_import_run_isolation((select id from test_ids_pir where key = 'run_failed_corrupted'))->>'snapshot_count')::int = 1
  ),
  'verify_import_run_isolation flags a failed run that left dangling snapshots as invalid'
);

-- Sanity: a succeeded run's snapshots are correctly reported as valid, not
-- mistaken for isolation violations.
with r as (
  insert into price_import_runs (price_source_id, source_ref, status, started_at, completed_at)
  select (select id from test_ids_pir where key = 'source'), 'pir-run-4-succeeded-with-snapshots', 'succeeded',
    now() - interval '5 minutes', now()
  returning id
)
insert into test_ids_pir (key, id) select 'run_succeeded_snapshots', id from r;

insert into price_snapshots (
  price_import_run_id, price_source_id, provider, source_product_id,
  card_printing_id, language, finish, price_type, amount, currency, observed_at
)
values (
  (select id from test_ids_pir where key = 'run_succeeded_snapshots'),
  (select id from test_ids_pir where key = 'source'),
  'pir_test_provider', 'ext-2',
  (select id from test_ids_pir where key = 'card_printing'),
  'en', 'normal', 'retail', 4.56, 'USD', now()
);

select ok(
  (
    select (verify_import_run_isolation((select id from test_ids_pir where key = 'run_succeeded_snapshots'))->>'valid')::boolean = true
      and (verify_import_run_isolation((select id from test_ids_pir where key = 'run_succeeded_snapshots'))->>'snapshots_created')::int = 1
  ),
  'verify_import_run_isolation reports a succeeded run''s snapshots as valid'
);

select finish();

rollback;
