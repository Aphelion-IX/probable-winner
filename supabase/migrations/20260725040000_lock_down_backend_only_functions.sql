-- Several SECURITY DEFINER functions were left with Postgres's default
-- PUBLIC execute grant -- no migration ever ran a REVOKE for them, so
-- get_advisors flags them as anon/authenticated-executable via PostgREST
-- RPC. Two categories found here:
--
-- 1. Payment bypass (critical): confirm_order_payment() and
--    release_failed_order_reservations() are meant to be called only by a
--    server-side Stripe webhook handler (AGENTS.md rule 10: "confirm via
--    Stripe webhook only"), but were callable directly by anon. Since
--    confirm_order_payment() only checks order status and stripe_event_id
--    idempotency -- it never actually verifies a Stripe signature or
--    payment -- any anon caller could mark an arbitrary pending order
--    'paid' and trigger inventory allocation for it without ever paying.
--
-- 2. Internal catalogue-import functions (import_set_and_promote,
--    process_catalogue_card) are meant to be called only by the
--    process-catalogue-import edge function's direct Postgres connection
--    (SUPABASE_DB_URL), not via PostgREST by anon/authenticated callers who
--    could otherwise inject arbitrary "catalogue" data.
--
-- get_latest_provider_import() and verify_import_run_isolation() are
-- read-only staff reporting helpers (companions to
-- get_import_failure_summary()/get_queue_health_metrics(), which already
-- had anon revoked) -- narrowed to authenticated + service_role rather than
-- service_role-only, matching that existing pattern.

revoke execute on function confirm_order_payment(uuid, text) from public, anon, authenticated;
grant execute on function confirm_order_payment(uuid, text) to service_role;

revoke execute on function release_failed_order_reservations(uuid) from public, anon, authenticated;
grant execute on function release_failed_order_reservations(uuid) to service_role;

revoke execute on function import_set_and_promote(text, jsonb) from public, anon, authenticated;
grant execute on function import_set_and_promote(text, jsonb) to service_role;

revoke execute on function process_catalogue_card(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function process_catalogue_card(uuid, uuid, uuid, jsonb) to service_role;

revoke execute on function get_latest_provider_import(text) from public, anon;
grant execute on function get_latest_provider_import(text) to authenticated, service_role;

revoke execute on function verify_import_run_isolation(uuid) from public, anon;
grant execute on function verify_import_run_isolation(uuid) to authenticated, service_role;
