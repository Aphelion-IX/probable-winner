-- RLS for pricing import tables (backlog B-151), matching the catalogue
-- importer's convention exactly (20260722113901): import run/error/snapshot
-- history is a staff concern (authenticated-only select, no anon read,
-- price data isn't customer-facing until it's published through a price
-- book in a later step), and raw staging rows are readable/writable by
-- nobody except the worker's direct Postgres connection, which bypasses RLS
-- entirely.

alter table price_sources enable row level security;
alter table price_import_runs enable row level security;
alter table price_import_errors enable row level security;
alter table price_snapshots enable row level security;

create policy price_sources_select on price_sources for select to authenticated using (true);
create policy price_import_runs_select on price_import_runs for select to authenticated using (true);
create policy price_import_errors_select on price_import_errors for select to authenticated using (true);
create policy price_snapshots_select on price_snapshots for select to authenticated using (true);

-- Zero policies -- staging rows hold unmapped raw provider payloads and are
-- never read outside the import job itself.
alter table price_staging_rows enable row level security;
