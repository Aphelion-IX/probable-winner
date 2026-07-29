-- Drops 20 unused, non-FK-covering indexes flagged by the Supabase
-- performance advisor (get_advisors, unused_index).
--
-- This is a deliberately narrowed list. The advisor originally flagged 95
-- unused indexes; investigating before dropping anything found two
-- categories that were NOT safe to include:
--
-- 1. store_credit_ledger_staff_user_id_idx -- created two migrations ago
--    specifically to fix an unindexed_foreign_keys finding, and simply
--    had not been queried yet. Excluded.
-- 2. 71 more indexes whose first column is a genuine foreign key on that
--    table (checked directly against pg_constraint) -- this repo has
--    prior migrations (add_missing_fk_indexes, targeted_hot_path_indexes)
--    that deliberately added FK-covering indexes for exactly this reason.
--    Dropping those would silently undo that work and reintroduce
--    unindexed_foreign_keys findings across ~71 relationships --
--    FK-covering indexes matter for cascade/constraint-check performance
--    on the referenced table regardless of how often the referencing
--    table itself is queried directly, so "unused" doesn't mean "safe" here.
--    Excluded.
-- 3. orders_guest_token_idx -- orders/checkout is the highest-stakes table
--    in the schema and no code path filtering orders by guest_token in a
--    WHERE clause could be found (the guest-token check in
--    checkout-ownership.ts compares an already-fetched row in memory, not
--    a DB filter), but that's absence-of-evidence, not proof it's dead.
--    Excluded out of caution.
--
-- The 20 remaining are all internal reporting/status/filter indexes
-- (audit log lookups, pricing-import exception triage, pick-batch status,
-- restock-alert status, ...) on staff-only tables, none covering a
-- foreign key, none on the orders/checkout path -- the closest this
-- advisor category gets to a clean case.

-- audit_events
drop index if exists audit_events_actor_idx;
drop index if exists audit_events_entity_idx;

-- calculated_prices
drop index if exists calculated_prices_created_idx;
drop index if exists calculated_prices_status_idx;

-- exchange_rates
drop index if exists exchange_rates_pair_latest_idx;

-- integration_events
drop index if exists integration_events_created_idx;

-- inventory_allocations
drop index if exists inventory_allocations_order_line_idx;

-- order_handovers
drop index if exists order_handovers_created_idx;

-- packing_shipments
drop index if exists shipments_created_idx;
drop index if exists shipments_status_idx;

-- pick_batches
drop index if exists pick_batches_active_idx;
drop index if exists pick_batches_created_idx;

-- pick_exceptions
drop index if exists pick_exceptions_created_idx;

-- price_alerts
drop index if exists price_alerts_status_idx;

-- price_import_exceptions
drop index if exists price_import_exceptions_card_source_idx;
drop index if exists price_import_exceptions_recorded_idx;
drop index if exists price_import_exceptions_source_idx;

-- restock_alerts
drop index if exists restock_alerts_status_idx;

-- store_credit_ledger
drop index if exists store_credit_ledger_reference_idx;

-- transfer_orders
drop index if exists transfer_orders_created_at_idx;
