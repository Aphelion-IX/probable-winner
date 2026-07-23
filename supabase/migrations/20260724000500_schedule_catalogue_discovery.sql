-- Weekly catalogue discovery trigger (blueprint §17, backlog B-040). New
-- MTG sets release far less often than prices change, so unlike the daily
-- pricing_import cron (20260723073400_schedule_price_import.sql) this runs
-- weekly. It enqueues a discovery message onto the existing catalogue_import
-- queue (created empty by migration 20260722120349_worker_queues.sql) rather
-- than a new queue -- the worker's catalogue-import-consumer recognises
-- {"discover": true} and expands it into one catalogue_import message per
-- MTGJSON set not already fully imported
-- (apps/worker/src/jobs/discover-catalogue-sets.ts). Runs as the cron job
-- owner (postgres), which already has USAGE on the pgmq schema, so no
-- SECURITY DEFINER wrapper is needed here either.

select cron.schedule(
  'weekly-catalogue-discovery',
  '0 5 * * 1',
  $$select pgmq.send('catalogue_import', '{"discover": true}'::jsonb)$$
);
