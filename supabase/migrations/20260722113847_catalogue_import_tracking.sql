-- Import run/error tracking and staging tables (backlog B-040, B-041, B-045).
-- The importer writes raw provider payloads into catalogue_staging_* first;
-- validation promotes rows into the live catalogue tables only after they
-- pass, so a corrupt or partial download never touches live data directly.

create table catalogue_import_runs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  source text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  sets_processed integer not null default 0,
  cards_processed integer not null default 0,
  created_at timestamptz not null default now()
);

create index catalogue_import_runs_game_idx on catalogue_import_runs (game_id);

create table catalogue_import_errors (
  id uuid primary key default gen_random_uuid(),
  catalogue_import_run_id uuid not null references catalogue_import_runs(id) on delete cascade,
  severity text not null default 'error' check (severity in ('warning', 'error')),
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);

create index catalogue_import_errors_run_idx on catalogue_import_errors (catalogue_import_run_id);

create table catalogue_staging_sets (
  id uuid primary key default gen_random_uuid(),
  catalogue_import_run_id uuid not null references catalogue_import_runs(id) on delete cascade,
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index catalogue_staging_sets_run_idx on catalogue_staging_sets (catalogue_import_run_id);

create table catalogue_staging_cards (
  id uuid primary key default gen_random_uuid(),
  catalogue_import_run_id uuid not null references catalogue_import_runs(id) on delete cascade,
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index catalogue_staging_cards_run_idx on catalogue_staging_cards (catalogue_import_run_id);
