-- pgTAP tests for the catalogue promotion upserts used by
-- apps/worker/src/jobs/promote-catalogue.ts (backlog B-042/B-043): running
-- the same upsert pass twice must be a no-op (zero duplicate rows, stable
-- ids), and Arabian Nights' real "variable rarity" cards (two printings,
-- same Scryfall oracle id, distinguished only by collector number) must
-- dedupe into exactly one oracle_cards row.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind) — see the commit that
-- added this file for the confirmed pass/fail output.
begin;

select plan(5);

create temp table test_ids (key text primary key, id uuid);
insert into test_ids (key, id) select 'game', id from games where code = 'mtg';

with s as (
  insert into sets (game_id, code, name, set_type, released_at, card_count)
  select id, 'ARNTEST', 'Arabian Nights (test)', 'expansion', '1993-12-17', 92
  from games where code = 'mtg'
  returning id
)
insert into test_ids (key, id) select 'set', id from s;

with oc as (
  insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
  select id, '3483946d-8645-4c22-b0ba-a65a44456324', 'Army of Allah', 'Instant'
  from games where code = 'mtg'
  returning id
)
insert into test_ids (key, id) select 'oracle_army', id from oc;

with p1 as (
  insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
  select (select id from test_ids where key='oracle_army'), (select id from test_ids where key='set'), '2', 'common'
  returning id
)
insert into test_ids (key, id) select 'printing_2', id from p1;

with p2 as (
  insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
  select (select id from test_ids where key='oracle_army'), (select id from test_ids where key='set'), '2†', 'common'
  returning id
)
insert into test_ids (key, id) select 'printing_2d', id from p2;

select ok(
  (select count(*) from oracle_cards where scryfall_oracle_id = '3483946d-8645-4c22-b0ba-a65a44456324') = 1,
  'Army of Allah #2 and #2† (same oracle id, real ambiguous case) dedupe to exactly one oracle_cards row'
);
select ok(
  (select count(*) from card_printings where oracle_card_id = (select id from test_ids where key='oracle_army')) = 2,
  'both printings are distinct card_printings rows, keyed by collector number'
);

-- Re-run the same upserts (simulating a second import pass).
insert into sets (game_id, code, name, set_type, released_at, card_count)
select id, 'ARNTEST', 'Arabian Nights (test)', 'expansion', '1993-12-17', 92
from games where code = 'mtg'
on conflict (game_id, code) do update set card_count = excluded.card_count;

insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
select id, '3483946d-8645-4c22-b0ba-a65a44456324', 'Army of Allah', 'Instant'
from games where code = 'mtg'
on conflict (game_id, scryfall_oracle_id) do update set name = excluded.name
returning id;

insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
select (select id from test_ids where key='oracle_army'), (select id from test_ids where key='set'), '2', 'common'
on conflict (set_id, collector_number) do update set rarity = excluded.rarity;

insert into card_printings (oracle_card_id, set_id, collector_number, rarity)
select (select id from test_ids where key='oracle_army'), (select id from test_ids where key='set'), '2†', 'common'
on conflict (set_id, collector_number) do update set rarity = excluded.rarity;

select ok(
  (select count(*) from oracle_cards where scryfall_oracle_id = '3483946d-8645-4c22-b0ba-a65a44456324') = 1,
  'zero net row-count change on oracle_cards after a second identical import pass (B-043)'
);
select ok(
  (select count(*) from card_printings where oracle_card_id = (select id from test_ids where key='oracle_army')) = 2,
  'zero net row-count change on card_printings after a second identical import pass (B-043)'
);
select ok(
  (select id from card_printings where set_id = (select id from test_ids where key='set') and collector_number = '2')
    = (select id from test_ids where key='printing_2'),
  'the second import pass updates the same printing row in place rather than creating a new one'
);

select finish();

rollback;
