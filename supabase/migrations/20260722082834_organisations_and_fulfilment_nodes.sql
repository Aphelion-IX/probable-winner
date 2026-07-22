create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table fulfilment_nodes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  code text not null,
  type text not null check (type in ('store', 'warehouse', 'distribution_centre', 'event_location')),
  region text,
  timezone text not null default 'UTC',
  active boolean not null default true,
  allows_click_collect boolean not null default false,
  allows_online_fulfilment boolean not null default false,
  allows_transfers boolean not null default false,
  dispatch_cutoff time,
  safety_stock_policy_id uuid,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create index fulfilment_nodes_org_idx on fulfilment_nodes (organisation_id);

create table store_addresses (
  id uuid primary key default gen_random_uuid(),
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  line1 text not null,
  line2 text,
  city text not null,
  region text,
  postal_code text,
  country text not null,
  created_at timestamptz not null default now()
);

create index store_addresses_node_idx on store_addresses (fulfilment_node_id);

create table store_hours (
  id uuid primary key default gen_random_uuid(),
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false,
  unique (fulfilment_node_id, day_of_week)
);

create table storage_locations (
  id uuid primary key default gen_random_uuid(),
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  code text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (fulfilment_node_id, code)
);

create index storage_locations_node_idx on storage_locations (fulfilment_node_id);
