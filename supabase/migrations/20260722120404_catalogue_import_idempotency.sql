-- Makes the catalogue importer resumable (backlog B-040 AC): a run is keyed
-- by a natural reference (e.g. 'mtgjson:set:ARN'), and staged rows are keyed
-- by the provider's own id within that run — so re-running the same job
-- after a crash re-uses the existing run and skips already-staged rows via
-- ON CONFLICT DO NOTHING, instead of downloading and inserting duplicates.

alter table catalogue_import_runs add column source_ref text not null default '';
alter table catalogue_import_runs alter column source_ref drop default;
create unique index catalogue_import_runs_game_source_ref_idx
  on catalogue_import_runs (game_id, source, source_ref);

alter table catalogue_staging_sets add column external_id text not null default '';
alter table catalogue_staging_sets alter column external_id drop default;
create unique index catalogue_staging_sets_run_external_idx
  on catalogue_staging_sets (catalogue_import_run_id, external_id);

alter table catalogue_staging_cards add column external_id text not null default '';
alter table catalogue_staging_cards alter column external_id drop default;
create unique index catalogue_staging_cards_run_external_idx
  on catalogue_staging_cards (catalogue_import_run_id, external_id);
