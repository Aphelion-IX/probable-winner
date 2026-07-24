-- Security advisor cleanup, part 2:
--
-- 1. price_import_summary was a plain `create view` (no security_invoker),
--    so it runs with the view owner's permissions/RLS bypass rather than
--    the querying user's -- Postgres flags this ERROR-level
--    (security_definer_view). Recreate with security_invoker = true, same
--    pattern already used for card_browse
--    (20260723004442_card_browse_view.sql).
--
-- 2. 19 SECURITY DEFINER functions were created without `set search_path`,
--    leaving search_path mutable by the caller -- a privilege-escalation
--    vector (a caller could create objects earlier in their search_path
--    that shadow ones the function expects to resolve unqualified). Pin
--    each to `public` via ALTER FUNCTION rather than replaying every
--    function body, since this only changes a function attribute and
--    carries no risk of dropping logic a later out-of-band live patch may
--    have added (see 20260724190000_fix_pricing_integration_events.sql's
--    reconciliation note for why that matters in this project).
--
-- Note: pg_net (also flagged, "extension in public") cannot be relocated --
-- `alter extension pg_net set schema ...` is rejected by Postgres
-- ("extension does not support SET SCHEMA"), and its actual objects
-- (net.http_post etc.) already live in their own dedicated `net` schema, not
-- `public`, so there's no real public-namespace exposure despite the
-- extension's own catalog entry being registered under `public`. Left as-is.

create or replace view price_import_summary
  with (security_invoker = true)
  as
  select
    ps.code as provider_code,
    ps.name as provider_name,
    pir.id as run_id,
    pir.source_ref,
    pir.status,
    pir.started_at,
    pir.completed_at,
    pir.completed_at - pir.started_at as duration,
    pir.raw_row_count,
    pir.mapped_row_count,
    pir.unmapped_row_count,
    pir.provider_healthy,
    pir.provider_health_message,
    (select count(*) from price_import_errors pie
      where pie.price_import_run_id = pir.id and pie.severity = 'error') as error_count,
    (select count(*) from price_import_errors pie
      where pie.price_import_run_id = pir.id and pie.severity = 'warning') as warning_count
  from price_import_runs pir
  join price_sources ps on ps.id = pir.price_source_id
  order by pir.completed_at desc, pir.started_at desc;

alter function is_trusted_backend_connection() set search_path = public;
alter function enforce_transfer_status_transition() set search_path = public;
alter function confirm_order_payment(uuid, text) set search_path = public;
alter function release_failed_order_reservations(uuid) set search_path = public;
alter function validate_checkout(uuid, uuid) set search_path = public;
alter function import_set_and_promote(text, jsonb) set search_path = public;
alter function process_catalogue_card(uuid, uuid, uuid, jsonb) set search_path = public;
alter function approve_suggested_price(uuid) set search_path = public;
alter function override_suggested_price(uuid, numeric) set search_path = public;
alter function reject_suggested_price(uuid) set search_path = public;
alter function publish_suggested_price(uuid) set search_path = public;
alter function get_latest_provider_import(text) set search_path = public;
alter function verify_import_run_isolation(uuid) set search_path = public;
alter function get_order_allocations(uuid) set search_path = public;
alter function verify_order_allocation_complete(uuid) set search_path = public;
alter function upsert_price_alert(uuid, text, numeric, text) set search_path = public;
alter function upsert_restock_alert(uuid, text, text) set search_path = public;
alter function set_price_override(uuid, uuid, numeric, text) set search_path = public;
alter function clear_price_override(uuid, uuid) set search_path = public;
