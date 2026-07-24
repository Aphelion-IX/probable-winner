-- Double-faced cards store separate front/back artwork under Scryfall's
-- own card_faces[].image_uris (per Scryfall's API docs) rather than one
-- image per card. card_images previously had no way to represent that --
-- one row per (card_printing_id, image_type) only, with an implicit single
-- face. Add an explicit face column so a DFC's front and back images can
-- both be stored without colliding on the same (printing, image_type) key.
-- The table has no rows yet (nothing has ever populated it), so this is a
-- safe, non-destructive shape change.
alter table card_images add column face text not null default 'front' check (face in ('front', 'back'));

alter table card_images drop constraint card_images_card_printing_id_image_type_key;
alter table card_images add constraint card_images_printing_type_face_uq unique (card_printing_id, image_type, face);
