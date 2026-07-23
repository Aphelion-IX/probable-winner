-- pgTAP tests for the pricing_import queue schedule (backlog B-151). Core
-- AC: a daily cron job exists and enqueues onto the pre-existing
-- pricing_import queue, the same one the worker's pricing-import-consumer
-- reads from.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project.
begin;

select plan(3);

select ok(
  exists(select 1 from cron.job where jobname = 'daily-price-import' and active),
  'the daily-price-import cron job exists and is active'
);

select ok(
  (select command from cron.job where jobname = 'daily-price-import') = $$select pgmq.send('pricing_import', '{}'::jsonb)$$,
  'the cron job enqueues onto the pricing_import queue, the same one the worker consumer reads'
);

select lives_ok(
  $$select pgmq.send('pricing_import', '{}'::jsonb)$$,
  'enqueueing onto pricing_import succeeds (the queue exists, created by 20260722120349)'
);

select finish();

rollback;
