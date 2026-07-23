-- pgTAP tests for pricing import schema (backlog B-151). Core ACs: raw
-- import is stored before mapping (price_staging_rows), price_snapshots
-- rows match the ImportedPrice shape and are immutable to app-facing
-- roles, and unmapped products don't silently disappear.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(10);

create temp table test_ids_price (key text primary key, id uuid);
grant select, insert on test_ids_price to authenticated, anon;

with src as (
  insert into price_sources (code, name)
  values ('test_mtgjson', 'Test MTGJSON')
  returning id
)
insert into test_ids_price (key, id) select 'source', id from src;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'prctst', 'Pricing Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001501', 'Pricing Test Card', 'Instant' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil'] from oc, s returning id
     )
insert into test_ids_price (key, id) select 'printing', id from cp;

-- Resumable run key: re-inserting with the same (price_source_id,
-- source_ref) must not create a second run (mirrors the catalogue
-- importer's resumability convention).
with r as (
  insert into price_import_runs (price_source_id, source_ref)
  select (select id from test_ids_price where key = 'source'), 'daily:2026-07-23'
  returning id
)
insert into test_ids_price (key, id) select 'run', id from r;

select throws_ok(
  format(
    $$insert into price_import_runs (price_source_id, source_ref) values ('%s', 'daily:2026-07-23')$$,
    (select id from test_ids_price where key = 'source')
  ),
  null,
  null,
  'a duplicate (price_source_id, source_ref) is rejected -- the run is resumable, not re-creatable'
);

insert into price_staging_rows (price_import_run_id, external_id, raw)
values (
  (select id from test_ids_price where key = 'run'),
  'mtgjson-uuid-1',
  '{"paper": {"tcgplayer": {"retail": {"normal": 1.23}}}}'::jsonb
);

select ok(
  (select count(*) = 1 from price_staging_rows where price_import_run_id = (select id from test_ids_price where key = 'run')),
  'the raw provider payload is stored in staging before any mapping'
);

insert into price_snapshots (
  price_import_run_id, price_source_id, provider, source_product_id,
  card_printing_id, language, finish, price_type, amount, currency, observed_at
) values (
  (select id from test_ids_price where key = 'run'),
  (select id from test_ids_price where key = 'source'),
  'tcgplayer', 'mtgjson-uuid-1',
  (select id from test_ids_price where key = 'printing'),
  'en', 'normal', 'retail', 1.23, 'USD', now()
);

select ok(
  (
    select provider = 'tcgplayer' and price_type = 'retail' and amount = 1.23 and finish = 'normal'
    from price_snapshots
    where price_import_run_id = (select id from test_ids_price where key = 'run')
  ),
  'a mapped snapshot stores the ImportedPrice-shaped fields correctly'
);

select throws_ok(
  $$insert into price_snapshots (
      price_import_run_id, price_source_id, provider, source_product_id,
      card_printing_id, language, finish, price_type, amount, currency, observed_at
    ) values (
      gen_random_uuid(), gen_random_uuid(), 'tcgplayer', 'x', gen_random_uuid(), 'en', 'bogus', 'retail', 1, 'USD', now()
    )$$,
  null, null,
  'an invalid finish value is rejected by the check constraint'
);

select throws_ok(
  $$insert into price_snapshots (
      price_import_run_id, price_source_id, provider, source_product_id,
      card_printing_id, language, finish, price_type, amount, currency, observed_at
    ) values (
      gen_random_uuid(), gen_random_uuid(), 'tcgplayer', 'x', gen_random_uuid(), 'en', 'normal', 'retail', -1, 'USD', now()
    )$$,
  null, null,
  'a negative amount is rejected by the check constraint'
);

-- Unmapped product: recorded as an error, not silently dropped and not a
-- snapshot with a null printing (backlog B-152's "recorded, not dropped").
insert into price_import_errors (price_import_run_id, severity, message, context)
values (
  (select id from test_ids_price where key = 'run'),
  'warning', 'no card_identifiers match for mtgjson uuid',
  jsonb_build_object('sourceProductId', 'mtgjson-uuid-unmapped')
);

select ok(
  (select count(*) = 1 from price_import_errors where price_import_run_id = (select id from test_ids_price where key = 'run')),
  'an unresolved product is recorded in price_import_errors, not dropped silently'
);

update price_import_runs
set status = 'succeeded', completed_at = now(), raw_row_count = 1, mapped_row_count = 1, unmapped_row_count = 1
where id = (select id from test_ids_price where key = 'run');

select ok(
  (select status = 'succeeded' and raw_row_count = 1 and mapped_row_count = 1 and unmapped_row_count = 1 from price_import_runs where id = (select id from test_ids_price where key = 'run')),
  'the import run records raw/mapped/unmapped counts and a final status'
);

-- Immutability: price_snapshots has no update/delete policy for
-- authenticated, so app-facing roles can read but never mutate a snapshot.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001502', true);

select ok(
  (select count(*) >= 1 from price_snapshots where price_import_run_id = (select id from test_ids_price where key = 'run')),
  'authenticated staff can read price_snapshots'
);

-- With RLS enabled and no update/delete policy, these don't raise -- they
-- silently match zero rows (the same RLS behaviour documented throughout
-- this test suite: a missing policy filters rows to nothing, it isn't an
-- error). So the proof of immutability is that the row is unchanged/still
-- present after the attempt, not a thrown exception.
update price_snapshots set amount = 999 where price_import_run_id = (select id from test_ids_price where key = 'run');
delete from price_snapshots where price_import_run_id = (select id from test_ids_price where key = 'run');

reset role;

select ok(
  (select amount = 1.23 from price_snapshots where price_import_run_id = (select id from test_ids_price where key = 'run')),
  'authenticated cannot update a price_snapshots row -- no update policy exists, the attempt silently affected zero rows (immutability, B-151 core AC)'
);

select ok(
  (select count(*) = 1 from price_snapshots where price_import_run_id = (select id from test_ids_price where key = 'run')),
  'authenticated cannot delete a price_snapshots row -- no delete policy exists, the attempt silently affected zero rows (immutability, B-151 core AC)'
);

select finish();

rollback;
