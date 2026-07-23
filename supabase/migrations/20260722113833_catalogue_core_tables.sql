-- Catalogue schema (blueprint §8.2, backlog Step 5 / B-042-B-043).
-- The catalogue describes the card, not its stock: no quantities, prices, or
-- store references live here (see inventory_balances / sellable_skus later).

create table games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table artists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table formats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (game_id, code)
);

create table sets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  code text not null,
  name text not null,
  set_type text,
  released_at date,
  card_count integer not null default 0,
  icon_url text,
  scryfall_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, code)
);

create index sets_game_idx on sets (game_id);

-- An oracle card is the shared rules identity behind every printing of "the
-- same card" (Scryfall's oracle_id concept) — Lightning Bolt is one
-- oracle_cards row no matter how many sets it's printed in.
create table oracle_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  scryfall_oracle_id uuid not null,
  name text not null,
  mana_cost text,
  cmc numeric,
  type_line text not null,
  oracle_text text,
  power text,
  toughness text,
  loyalty text,
  colors text[] not null default '{}',
  color_identity text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, scryfall_oracle_id)
);

create index oracle_cards_name_idx on oracle_cards (name);

create table card_printings (
  id uuid primary key default gen_random_uuid(),
  oracle_card_id uuid not null references oracle_cards(id) on delete cascade,
  set_id uuid not null references sets(id) on delete cascade,
  artist_id uuid references artists(id),
  collector_number text not null,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'mythic', 'special', 'bonus')),
  frame text,
  border_color text,
  flavor_text text,
  is_promo boolean not null default false,
  is_variation boolean not null default false,
  released_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (set_id, collector_number)
);

create index card_printings_oracle_card_idx on card_printings (oracle_card_id);
create index card_printings_set_idx on card_printings (set_id);

-- Cross-references to external providers (blueprint §3.3): one row per
-- printing, since MTGJSON/Scryfall/TCGplayer ids are printing-specific, not
-- oracle-level.
create table card_identifiers (
  id uuid primary key default gen_random_uuid(),
  card_printing_id uuid not null references card_printings(id) on delete cascade unique,
  mtgjson_uuid uuid unique,
  scryfall_id uuid unique,
  tcgplayer_product_id bigint,
  cardmarket_id bigint,
  multiverse_ids integer[] not null default '{}',
  created_at timestamptz not null default now()
);

create table card_images (
  id uuid primary key default gen_random_uuid(),
  card_printing_id uuid not null references card_printings(id) on delete cascade,
  image_type text not null check (image_type in ('small', 'normal', 'large', 'png', 'art_crop', 'border_crop')),
  url text not null,
  created_at timestamptz not null default now(),
  unique (card_printing_id, image_type)
);

create index card_images_printing_idx on card_images (card_printing_id);

create table card_legalities (
  id uuid primary key default gen_random_uuid(),
  oracle_card_id uuid not null references oracle_cards(id) on delete cascade,
  format_id uuid not null references formats(id) on delete cascade,
  status text not null check (status in ('legal', 'not_legal', 'restricted', 'banned')),
  updated_at timestamptz not null default now(),
  unique (oracle_card_id, format_id)
);

create index card_legalities_oracle_card_idx on card_legalities (oracle_card_id);

insert into games (code, name) values ('mtg', 'Magic: The Gathering');

insert into formats (game_id, code, name)
select g.id, v.code, v.name
from games g, (values
  ('standard', 'Standard'),
  ('pioneer', 'Pioneer'),
  ('modern', 'Modern'),
  ('legacy', 'Legacy'),
  ('vintage', 'Vintage'),
  ('pauper', 'Pauper'),
  ('commander', 'Commander'),
  ('oathbreaker', 'Oathbreaker'),
  ('brawl', 'Brawl'),
  ('duel', 'Duel Commander'),
  ('oldschool', 'Old School'),
  ('premodern', 'Premodern'),
  ('predh', 'Pre-Modern EDH'),
  ('penny', 'Penny Dreadful')
) as v(code, name)
where g.code = 'mtg';
