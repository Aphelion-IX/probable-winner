-- pgTAP tests for card_images' face column (20260725000000) and
-- card_browse's new image_url column (20260725010000) -- both added to
-- support "use Scryfall as the card image importer": a double-faced
-- card's front and back need to coexist under the same image_type, and
-- the browse grid needs a single preferred (normal, front) URL per
-- printing.
begin;

select plan(4);

create temp table test_ids_cif (key text primary key, id uuid);
grant select, insert on test_ids_cif to authenticated, anon;

with g as (select id from games where code = 'mtg'),
     s as (
       insert into sets (game_id, code, name)
       select id, 'cifts', 'Card Image Faces Test Set' from g
       returning id
     ),
     oc as (
       insert into oracle_cards (game_id, scryfall_oracle_id, name, type_line)
       select id, '00000000-0000-0000-0000-000000001501', 'CIF Test DFC', 'Creature // Creature' from g
       returning id
     ),
     cp as (
       insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes)
       select oc.id, s.id, '1', 'common', array['nonfoil'] from oc, s returning id
     )
insert into test_ids_cif (key, id) select 'printing', id from cp;

-- A double-faced card's front and back can both have a "normal" image.
insert into card_images (card_printing_id, image_type, face, url)
values
  ((select id from test_ids_cif where key = 'printing'), 'normal', 'front', 'https://example.invalid/front-normal.jpg'),
  ((select id from test_ids_cif where key = 'printing'), 'normal', 'back', 'https://example.invalid/back-normal.jpg');

select ok(
  (select count(*) = 2 from card_images where card_printing_id = (select id from test_ids_cif where key = 'printing')),
  'a front and a back row for the same image_type coexist (the whole point of the face column)'
);

select throws_ok(
  format(
    $$insert into card_images (card_printing_id, image_type, face, url)
      values ('%s', 'normal', 'front', 'https://example.invalid/duplicate.jpg')$$,
    (select id from test_ids_cif where key = 'printing')
  ),
  '23505',
  null,
  'a duplicate (printing, image_type, face) row is still rejected'
);

select ok(
  (
    select face in ('front', 'back')
    from card_images
    where card_printing_id = (select id from test_ids_cif where key = 'printing')
    limit 1
  ),
  'face is constrained to front/back'
);

-- card_browse exposes the front-face "normal" image, not the back or any
-- other image_type, as image_url.
select ok(
  (
    select image_url = 'https://example.invalid/front-normal.jpg'
    from card_browse
    where printing_id = (select id from test_ids_cif where key = 'printing')
  ),
  'card_browse.image_url resolves to the front-face normal image'
);

select finish();

rollback;
