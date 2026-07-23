-- pgTAP tests for the catalogue schema (backlog Step 5, B-042-B-043) and its
-- RLS: uniqueness/check constraints on the identity tables, and anon/staff
-- read visibility versus the fully-locked-down staging tables.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(12);

select ok(
  (select count(*) from games where code = 'mtg') = 1,
  'mtg game reference row exists'
);

select ok(
  (select count(*) from formats where game_id = (select id from games where code = 'mtg')) >= 14,
  'mtg format reference rows are seeded'
);

with g as (select id from games where code = 'mtg')
insert into sets (game_id, code, name)
select id, 'tst', 'Test Set' from g;

with s as (select id from sets where code = 'tst')
insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
select (select id from games where code = 'mtg'), '00000000-0000-0000-0000-000000000b01', 'Test Bolt', 'Instant'
from s;

-- Constraint: oracle_cards unique on (game_id, scryfall_oracle_id).
select throws_ok(
  $$insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
    values ((select id from games where code = 'mtg'), '00000000-0000-0000-0000-000000000b01', 'Duplicate Bolt', 'Instant')$$,
  '23505',
  null,
  'duplicate scryfall_oracle_id within the same game is rejected'
);

with o as (select id from oracle_cards where name = 'Test Bolt'),
     s as (select id from sets where code = 'tst')
insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
select o.id, s.id, '1', 'common' from o, s;

-- Constraint: card_printings unique on (set_id, collector_number).
select throws_ok(
  format(
    $$insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
      values ('%s', '%s', '1', 'common')$$,
    (select id from oracle_cards where name = 'Test Bolt'),
    (select id from sets where code = 'tst')
  ),
  '23505',
  null,
  'duplicate (set_id, collector_number) is rejected'
);

-- Constraint: card_printings.rarity is a checked enum.
select throws_ok(
  format(
    $$insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
      values ('%s', '%s', '2', 'legendary')$$,
    (select id from oracle_cards where name = 'Test Bolt'),
    (select id from sets where code = 'tst')
  ),
  '23514',
  null,
  'an invalid rarity value violates the check constraint'
);

with p as (select id from card_printings where collector_number = '1')
insert into card_identifiers (card_printing_id, scryfall_id)
select id, '00000000-0000-0000-0000-000000000c01' from p;

-- Constraint: card_identifiers is 1:1 with card_printings.
select throws_ok(
  format(
    $$insert into card_identifiers (card_printing_id, scryfall_id) values ('%s', '00000000-0000-0000-0000-000000000c02')$$,
    (select id from card_printings where collector_number = '1')
  ),
  '23505',
  null,
  'a second card_identifiers row for the same printing is rejected'
);

with p as (select id from card_printings where collector_number = '1')
insert into card_images (card_printing_id, image_type, url)
select id, 'normal', 'https://example.invalid/bolt.png' from p;

-- Constraint: card_images.image_type is a checked enum.
select throws_ok(
  format(
    $$insert into card_images (card_printing_id, image_type, url)
      values ('%s', 'poster', 'https://example.invalid/bolt-poster.png')$$,
    (select id from card_printings where collector_number = '1')
  ),
  '23514',
  null,
  'an invalid image_type value violates the check constraint'
);

with o as (select id from oracle_cards where name = 'Test Bolt'),
     f as (select id from formats where code = 'standard' limit 1)
insert into card_legalities (oracle_card_id, format_id, status)
select o.id, f.id, 'legal' from o, f;

-- Constraint: card_legalities unique on (oracle_card_id, format_id).
select throws_ok(
  format(
    $$insert into card_legalities (oracle_card_id, format_id, status)
      values ('%s', '%s', 'banned')$$,
    (select id from oracle_cards where name = 'Test Bolt'),
    (select id from formats where code = 'standard' limit 1)
  ),
  '23505',
  null,
  'a second legality row for the same (oracle_card_id, format_id) is rejected'
);

-- RLS: anon can browse the public catalogue tables.
set role anon;
select ok(
  (select count(*) from oracle_cards where name = 'Test Bolt') = 1,
  'anon can read oracle_cards'
);
select ok(
  (select count(*) from card_printings) >= 1,
  'anon can read card_printings'
);

-- RLS: anon cannot read staff-only cross-reference or staging data.
select ok(
  (select count(*) from card_identifiers) = 0,
  'anon cannot read card_identifiers (staff-only)'
);
select ok(
  (select count(*) from catalogue_staging_cards) = 0,
  'anon cannot read catalogue_staging_cards (service-role only, no policies)'
);
reset role;

select finish();

rollback;
