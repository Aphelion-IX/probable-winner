-- Pricing import tracking (blueprint §8.6/§15.3, backlog B-151). Mirrors the
-- catalogue importer's shape (catalogue_import_runs/catalogue_staging_cards,
-- see 20260722113847/20260722120404): a run is keyed by a natural reference
-- so a crash-and-retry resumes instead of re-downloading, and raw provider
-- payloads land in a staging table before any mapping/normalisation touches
-- price_snapshots.

create table price_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table price_import_runs (
  id uuid primary key default gen_random_uuid(),
  price_source_id uuid not null references price_sources(id) on delete cascade,
  source_ref text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  raw_row_count integer not null default 0,
  mapped_row_count integer not null default 0,
  unmapped_row_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (price_source_id, source_ref)
);

create index price_import_runs_source_idx on price_import_runs (price_source_id);

create table price_import_errors (
  id uuid primary key default gen_random_uuid(),
  price_import_run_id uuid not null references price_import_runs(id) on delete cascade,
  severity text not null default 'error' check (severity in ('warning', 'error')),
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);

create index price_import_errors_run_idx on price_import_errors (price_import_run_id);

-- One raw row per provider product id per run -- the mapping step (in the
-- worker job, not here) flattens each row's nested provider/list-type/finish
-- data into zero or more price_snapshots rows.
create table price_staging_rows (
  id uuid primary key default gen_random_uuid(),
  price_import_run_id uuid not null references price_import_runs(id) on delete cascade,
  external_id text not null,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  unique (price_import_run_id, external_id)
);

create index price_staging_rows_run_idx on price_staging_rows (price_import_run_id);
