-- pgTAP tests for card_browse's set_icon_url column (20260725020000),
-- backing apps/worker's import-set-symbols job (sets.icon_url/scryfall_id
-- already existed on the schema, unpopulated, until that job).
begin;

select plan(2);

create temp table test_ids_cbsi (key text primary key, id uuid);
grant select, insert on test_ids_cbsi to authenticated, anon;

with g as (select id from games where code = 'mtg'),
     s_iconed as (
       insert into sets (game_id, code, name, icon_url, scryfall_id)
       select id, 'cbsit', 'Card Browse Set Icon Test', 'https://svgs.scryfall.io/sets/cbsit.svg', '00000000-0000-0000-0000-000000001601'
       from g
       returning id
     )
insert into test_ids_cbsi (key, id) select 'set_iconed', id from s_iconed;

with g as (select id from games where code = 'mtg'),
     s_no_icon as (
       insert into sets (game_id, code, name)
       select id, 'cbsit2', 'Card Browse Set Icon Test (no icon yet)' from g
       returning id
     )
insert into test_ids_cbsi (key, id) select 'set_no_icon', id from s_no_icon;

with oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select (select id from games where code = 'mtg'), '00000000-0000-0000-0000-000000001602', 'CBSI Test Card', 'Instant'
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, (select id from test_ids_cbsi where key = 'set_iconed'), '1', 'common', array['nonfoil']
       from oc
       returning id
     )
insert into test_ids_cbsi (key, id) select 'printing_iconed', id from cp;

with oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select (select id from games where code = 'mtg'), '00000000-0000-0000-0000-000000001603', 'CBSI Test Card 2', 'Instant'
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, (select id from test_ids_cbsi where key = 'set_no_icon'), '1', 'common', array['nonfoil']
       from oc
       returning id
     )
insert into test_ids_cbsi (key, id) select 'printing_no_icon', id from cp;

select ok(
  (
    select set_icon_url = 'https://svgs.scryfall.io/sets/cbsit.svg'
    from card_browse
    where printing_id = (select id from test_ids_cbsi where key = 'printing_iconed')
  ),
  'card_browse.set_icon_url resolves to the set''s icon_url'
);

select ok(
  (
    select set_icon_url is null
    from card_browse
    where printing_id = (select id from test_ids_cbsi where key = 'printing_no_icon')
  ),
  'card_browse.set_icon_url is null (not an error) for a set with no icon yet'
);

select finish();

rollback;
