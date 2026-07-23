-- Daily pricing import trigger (blueprint §15.3/§17, backlog B-151). A
-- price import isn't a reaction to a domain event like stock reconciliation
-- (20260723063559) -- it's a scheduled pull from an external provider, so
-- pg_cron enqueues directly onto the pricing_import queue (already created
-- empty by migration 20260722120349) rather than a row-level trigger firing
-- pgmq.send(). Runs as the cron job owner (postgres), which already has
-- USAGE on the pgmq schema, so no SECURITY DEFINER wrapper is needed here
-- the way enqueue_stock_reconciliation() needed one for authenticated.

select cron.schedule(
  'daily-price-import',
  '0 6 * * *',
  $$select pgmq.send('pricing_import', '{}'::jsonb)$$
);
