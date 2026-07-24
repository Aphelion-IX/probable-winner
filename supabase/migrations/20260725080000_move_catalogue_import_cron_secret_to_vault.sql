-- The catalogue-import-worker cron job
-- (20260723133205_catalogue_import_edge_function_cron.sql) had the
-- Supabase anon JWT hardcoded directly in its cron.job command text --
-- readable in plaintext via `select command from cron.job` and in
-- pg_cron's own logging of the command it runs. It's the public anon key,
-- not a secret in the security sense, but there's no reason to leave a
-- long-lived token sitting in plaintext in a system catalog either.
--
-- The actual key value is stored in Vault as the 'catalogue_import_anon_key'
-- secret (seeded once directly against the project, not via a migration
-- file, so the literal token never lands in git history either). This
-- migration only wires the cron job to look it up by name.
--
-- cron.schedule() upserts by job_name, so this updates the existing job in
-- place rather than creating a duplicate.
select cron.schedule(
  'catalogue-import-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://lbsxsptpyhypuheuosye.supabase.co/functions/v1/process-catalogue-import',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'catalogue_import_anon_key'
        limit 1
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
