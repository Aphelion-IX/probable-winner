-- Schedule automatic processing of the catalogue_import queue.
-- pg_net lets Postgres make outbound HTTP calls; pg_cron invokes the
-- process-catalogue-import Edge Function every minute so the queue drains
-- without any external worker or manual trigger.

create extension if not exists pg_net;

select cron.unschedule('catalogue-import-worker') where exists (
  select 1 from cron.job where jobname = 'catalogue-import-worker'
);

select cron.schedule(
  'catalogue-import-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://lbsxsptpyhypuheuosye.supabase.co/functions/v1/process-catalogue-import',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxic3hzcHRweWh5cHVoZXVvc3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2ODcxOTIsImV4cCI6MjEwMDI2MzE5Mn0.NlMazoT_3FuQfF26-jOKOHfy4GuA6b1keRtPq0v49lE',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
