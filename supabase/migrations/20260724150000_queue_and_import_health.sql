-- Staff-visible queue/import health (backlog B-202). The pgmq schema is not
-- in the Data API's exposed schema list (supabase/config.toml api.schemas =
-- ["public", "storage", "graphql_public"]), so apps/web (anon/authenticated
-- key only, no direct pgmq access) needs a public-schema wrapper to read
-- queue metrics -- same reasoning as every other security definer helper in
-- this codebase that bridges a privileged operation into something callable
-- via the Data API. apps/worker (direct Postgres connection, sees every
-- schema) doesn't need this and queries pgmq.metrics_all() itself in
-- apps/worker/src/monitoring/queue-health.ts; this migration exists for the
-- staff monitoring page in apps/web.

-- Any active staff member (regardless of scope) can view platform-wide
-- operational health -- queue backlog and import failures aren't
-- store/org-scoped data, unlike everything else RLS-gated in this schema.
create or replace function is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from staff_memberships m
    where m.user_id = auth.uid() and m.active
  );
$$;

revoke execute on function is_active_staff() from public, anon;
grant execute on function is_active_staff() to authenticated;

create or replace function get_queue_health_metrics()
returns table (
  queue_name text,
  queue_length bigint,
  oldest_msg_age_sec integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_active_staff() then
    raise exception 'get_queue_health_metrics: access denied' using errcode = '42501';
  end if;

  return query
  select m.queue_name, m.queue_length, m.oldest_msg_age_sec
  from pgmq.metrics_all() m
  where m.queue_name = any(array[
    'catalogue_import', 'pricing_import', 'search_index', 'email',
    'restock_alerts', 'order_processing', 'reservation_cleanup',
    'stock_reconciliation', 'report_generation'
  ]);
end;
$$;

revoke execute on function get_queue_health_metrics() from public, anon;
grant execute on function get_queue_health_metrics() to authenticated;

create or replace function get_import_failure_summary(p_lookback_hours integer default 24)
returns table (
  source text,
  failed_run_count integer,
  most_recent_failure_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_active_staff() then
    raise exception 'get_import_failure_summary: access denied' using errcode = '42501';
  end if;

  return query
  select 'catalogue_import'::text, count(*)::int, max(started_at)
  from catalogue_import_runs
  where status = 'failed' and started_at > now() - make_interval(hours => p_lookback_hours)
  union all
  select 'pricing_import'::text, count(*)::int, max(started_at)
  from price_import_runs
  where status = 'failed' and started_at > now() - make_interval(hours => p_lookback_hours);
end;
$$;

revoke execute on function get_import_failure_summary(integer) from public, anon;
grant execute on function get_import_failure_summary(integer) to authenticated;
