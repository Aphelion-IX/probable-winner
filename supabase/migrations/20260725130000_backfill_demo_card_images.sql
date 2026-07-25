-- The demo catalogue seed (20260725110000_seed_demo_catalogue.sql) gave
-- each of its 15 real Magic cards a random gen_random_uuid() as
-- oracle_cards.scryfall_oracle_id -- a placeholder, not a real Scryfall
-- identifier -- and never populated card_images at all, so every demo
-- card rendered the CardTile "no image available" fallback everywhere
-- (homepage rail, hero collage, card identity pages).
--
-- This backfills real card_images rows for the 15 demo cards specifically,
-- with image URLs fetched live from Scryfall's public /cards/named API for
-- each exact card name (these are real, well-known cards with stable
-- Scryfall records). Deliberately does NOT also insert into
-- card_identifiers: these demo printings are synthetic ("Demo Showcase"
-- set, not a real Scryfall printing), and several of the exact Scryfall
-- printings returned by /cards/named already belong to a different,
-- real card_printing_id from the actual 868-set MTGJSON/Scryfall catalogue
-- import (confirmed by a unique-constraint violation on
-- card_identifiers.scryfall_id when this was first attempted) -- claiming
-- that identity for the demo printing too would be incorrect, and nothing
-- reads card_identifiers for display, only card_images.

do $$
declare
  v_printing_id uuid;
begin

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Sol Ring' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.png?1783903215')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Black Lotus' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg?1783939332')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg?1783939332')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg?1783939332')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.png?1783939332')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg?1783939332')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg?1783939332')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Lightning Bolt' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.png?1783903008')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Counterspell' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1783909630')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1783909630')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1783909630')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.png?1783909630')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1783909630')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1783909630')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Swords to Plowshares' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/b/4/b4e9c870-23c0-413a-ae39-265f09da16d1.jpg?1783903243')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/b/4/b4e9c870-23c0-413a-ae39-265f09da16d1.jpg?1783903243')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/b/4/b4e9c870-23c0-413a-ae39-265f09da16d1.jpg?1783903243')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/b/4/b4e9c870-23c0-413a-ae39-265f09da16d1.png?1783903243')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/b/4/b4e9c870-23c0-413a-ae39-265f09da16d1.jpg?1783903243')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/b/4/b4e9c870-23c0-413a-ae39-265f09da16d1.jpg?1783903243')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Dark Ritual' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/1/1/11e12a84-e7be-4afc-a230-c2e644743fa8.jpg?1783903013')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/1/1/11e12a84-e7be-4afc-a230-c2e644743fa8.jpg?1783903013')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/1/1/11e12a84-e7be-4afc-a230-c2e644743fa8.jpg?1783903013')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/1/1/11e12a84-e7be-4afc-a230-c2e644743fa8.png?1783903013')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/1/1/11e12a84-e7be-4afc-a230-c2e644743fa8.jpg?1783903013')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/1/1/11e12a84-e7be-4afc-a230-c2e644743fa8.jpg?1783903013')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Llanowar Elves' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg?1783909057')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg?1783909057')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg?1783909057')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.png?1783909057')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg?1783909057')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg?1783909057')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Wrath of God' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/5/3/537d2b05-3f52-45d6-8fe3-26282085d0c6.jpg?1783915706')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/5/3/537d2b05-3f52-45d6-8fe3-26282085d0c6.jpg?1783915706')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/5/3/537d2b05-3f52-45d6-8fe3-26282085d0c6.jpg?1783915706')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/5/3/537d2b05-3f52-45d6-8fe3-26282085d0c6.png?1783915706')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/5/3/537d2b05-3f52-45d6-8fe3-26282085d0c6.jpg?1783915706')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/5/3/537d2b05-3f52-45d6-8fe3-26282085d0c6.jpg?1783915706')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Birds of Paradise' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.jpg?1783903230')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.jpg?1783903230')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.jpg?1783903230')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.png?1783903230')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.jpg?1783903230')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.jpg?1783903230')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Doubling Season' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1783909062')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1783909062')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1783909062')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.png?1783909062')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1783909062')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1783909062')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Mana Crypt' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/4/d/4d960186-4559-4af0-bd22-63baa15f8939.jpg?1783930103')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/4/d/4d960186-4559-4af0-bd22-63baa15f8939.jpg?1783930103')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/4/d/4d960186-4559-4af0-bd22-63baa15f8939.jpg?1783930103')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/4/d/4d960186-4559-4af0-bd22-63baa15f8939.png?1783930103')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/4/d/4d960186-4559-4af0-bd22-63baa15f8939.jpg?1783930103')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/4/d/4d960186-4559-4af0-bd22-63baa15f8939.jpg?1783930103')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Command Tower' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/0/5/0548fb60-c843-4f8f-a029-6f10efc63a41.jpg?1783903206')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/0/5/0548fb60-c843-4f8f-a029-6f10efc63a41.jpg?1783903206')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/0/5/0548fb60-c843-4f8f-a029-6f10efc63a41.jpg?1783903206')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/0/5/0548fb60-c843-4f8f-a029-6f10efc63a41.png?1783903206')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/0/5/0548fb60-c843-4f8f-a029-6f10efc63a41.jpg?1783903206')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/0/5/0548fb60-c843-4f8f-a029-6f10efc63a41.jpg?1783903206')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Cavern of Souls' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/3/a/3aad15a2-8a1b-4460-9b06-e85863081878.jpg?1783913719')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/3/a/3aad15a2-8a1b-4460-9b06-e85863081878.jpg?1783913719')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/3/a/3aad15a2-8a1b-4460-9b06-e85863081878.jpg?1783913719')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/3/a/3aad15a2-8a1b-4460-9b06-e85863081878.png?1783913719')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/3/a/3aad15a2-8a1b-4460-9b06-e85863081878.jpg?1783913719')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/3/a/3aad15a2-8a1b-4460-9b06-e85863081878.jpg?1783913719')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Jeweled Lotus' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/d/7/d7183700-6941-4a3d-a581-4f33bea795e9.jpg?1783915595')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/d/7/d7183700-6941-4a3d-a581-4f33bea795e9.jpg?1783915595')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/d/7/d7183700-6941-4a3d-a581-4f33bea795e9.jpg?1783915595')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/d/7/d7183700-6941-4a3d-a581-4f33bea795e9.png?1783915595')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/d/7/d7183700-6941-4a3d-a581-4f33bea795e9.jpg?1783915595')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/d/7/d7183700-6941-4a3d-a581-4f33bea795e9.jpg?1783915595')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;

  select cp.id into v_printing_id
  from card_printings cp
  join oracle_cards oc on oc.id = cp.oracle_card_id
  join sets s on s.id = cp.set_id
  where oc.name = 'Demonic Tutor' and s.code = 'dsc';

  if v_printing_id is not null then
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'small', 'front', 'https://cards.scryfall.io/small/front/a/2/a24b4cb6-cebb-428b-8654-74347a6a8d63.jpg?1783915679')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'normal', 'front', 'https://cards.scryfall.io/normal/front/a/2/a24b4cb6-cebb-428b-8654-74347a6a8d63.jpg?1783915679')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'large', 'front', 'https://cards.scryfall.io/large/front/a/2/a24b4cb6-cebb-428b-8654-74347a6a8d63.jpg?1783915679')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'png', 'front', 'https://cards.scryfall.io/png/front/a/2/a24b4cb6-cebb-428b-8654-74347a6a8d63.png?1783915679')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'art_crop', 'front', 'https://cards.scryfall.io/art_crop/front/a/2/a24b4cb6-cebb-428b-8654-74347a6a8d63.jpg?1783915679')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
    insert into card_images (card_printing_id, image_type, face, url)
    values (v_printing_id, 'border_crop', 'front', 'https://cards.scryfall.io/border_crop/front/a/2/a24b4cb6-cebb-428b-8654-74347a6a8d63.jpg?1783915679')
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url;
  end if;
end $$;