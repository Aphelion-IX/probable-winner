-- Catalogue data is public storefront reference data — customers browse
-- without logging in, so these are readable by anon (unlike the staff/store
-- tables in the previous migration, which require an active membership).
-- No write policies exist anywhere here: the importer writes via the
-- service-role key (bypasses RLS entirely), matching hard rule 2's "no
-- manual writes outside an atomic backend process" for inventory.

alter table games enable row level security;
alter table artists enable row level security;
alter table formats enable row level security;
alter table sets enable row level security;
alter table oracle_cards enable row level security;
alter table card_printings enable row level security;
alter table card_images enable row level security;
alter table card_legalities enable row level security;

create policy games_select on games for select to anon, authenticated using (true);
create policy artists_select on artists for select to anon, authenticated using (true);
create policy formats_select on formats for select to anon, authenticated using (true);
create policy sets_select on sets for select to anon, authenticated using (true);
create policy oracle_cards_select on oracle_cards for select to anon, authenticated using (true);
create policy card_printings_select on card_printings for select to anon, authenticated using (true);
create policy card_images_select on card_images for select to anon, authenticated using (true);
create policy card_legalities_select on card_legalities for select to anon, authenticated using (true);

-- Cross-references to external providers are an internal/staff concern, not
-- needed by the storefront UI — authenticated only, no anon read.
alter table card_identifiers enable row level security;
create policy card_identifiers_select on card_identifiers for select to authenticated using (true);

-- Import run history and errors back the staff-visible import summary
-- (B-045) — staff-only, no anon read.
alter table catalogue_import_runs enable row level security;
alter table catalogue_import_errors enable row level security;
create policy catalogue_import_runs_select on catalogue_import_runs for select to authenticated using (true);
create policy catalogue_import_errors_select on catalogue_import_errors for select to authenticated using (true);

-- Staging tables have RLS enabled with zero policies: only the service-role
-- worker (which bypasses RLS) can read or write them, deliberately.
alter table catalogue_staging_sets enable row level security;
alter table catalogue_staging_cards enable row level security;
