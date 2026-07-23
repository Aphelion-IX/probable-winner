-- Sellable products (blueprint §8.3, backlog Step 6 / B-050).
-- A sellable SKU is the exact thing a customer can buy: printing + language +
-- finish + condition. This is distinct from card_printings.finishes (which
-- finishes a printing was ever produced in) and distinct from inventory
-- (this table has no quantities — see inventory_balances, backlog B-060).

create extension if not exists "uuid-ossp" with schema extensions;

create table conditions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null unique,
  created_at timestamptz not null default now()
);

create table languages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- Mirrors the finishes card_printings.finishes already checks against
-- (nonfoil/foil/etched) but as a reference table so sellable_skus can carry
-- a foreign key rather than repeating the check constraint.
create table finishes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('nonfoil', 'foil', 'etched')),
  name text not null,
  created_at timestamptz not null default now()
);

create table product_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

insert into conditions (code, name, sort_order) values
  ('nm', 'Near Mint', 1),
  ('lp', 'Lightly Played', 2),
  ('mp', 'Moderately Played', 3),
  ('hp', 'Heavily Played', 4),
  ('dmg', 'Damaged', 5);

insert into languages (code, name) values
  ('en', 'English'),
  ('ja', 'Japanese'),
  ('de', 'German'),
  ('fr', 'French'),
  ('it', 'Italian'),
  ('es', 'Spanish'),
  ('pt', 'Portuguese'),
  ('ru', 'Russian'),
  ('ko', 'Korean'),
  ('zhs', 'Chinese Simplified'),
  ('zht', 'Chinese Traditional');

insert into finishes (code, name) values
  ('nonfoil', 'Nonfoil'),
  ('foil', 'Foil'),
  ('etched', 'Etched Foil');

insert into product_statuses (code, name) values
  ('active', 'Active'),
  ('hidden', 'Hidden'),
  ('discontinued', 'Discontinued');

-- Fixed namespace for the name-based (v5) SKU id below. Deterministic and
-- arbitrary — any fixed UUID works as a uuid_generate_v5 namespace, this one
-- was generated once and must never change or every existing SKU id shifts.
-- A stable id (not a random UUID regenerated on every import) matters
-- because inventory_balances/inventory_movements (backlog B-060) reference
-- sellable_sku_id, and regenerating SKUs must not orphan that data.
create table sellable_skus (
  card_printing_id uuid not null references card_printings(id) on delete cascade,
  language_id uuid not null references languages(id),
  finish_id uuid not null references finishes(id),
  condition_id uuid not null references conditions(id),
  product_status_id uuid not null references product_statuses(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  id uuid generated always as (
    extensions.uuid_generate_v5(
      'f7e5c9a0-6b1d-4e2a-9c3f-1a2b3c4d5e6f'::uuid,
      card_printing_id::text || ':' || language_id::text || ':' || finish_id::text || ':' || condition_id::text
    )
  ) stored primary key,
  unique (card_printing_id, language_id, finish_id, condition_id)
);

create index sellable_skus_printing_idx on sellable_skus (card_printing_id);
