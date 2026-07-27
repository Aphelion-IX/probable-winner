-- Grants the baseline table-level privileges that every RLS-policed table
-- in this schema was always missing from its migration history.
--
-- CI's first-ever successful `supabase test db` run (the previous two
-- migrations exist specifically to get a fresh reset that far) failed
-- across 20+ unrelated pgTAP files -- pricing, transfers, stocktakes,
-- quarantine, inventory, catalogue, customer profiles -- every one of them
-- with `permission denied for table X` for `anon`/`authenticated`, even
-- though each of those tables already has RLS enabled and a policy that
-- should permit exactly the access being attempted.
--
-- The reason: a `CREATE POLICY` only decides which *rows* a role can see
-- or touch once Postgres has already decided that role may operate on the
-- table *at all* -- that first decision is an ordinary GRANT, which every
-- migration in this repository already assumes exists (its own comments
-- talk about "RLS coverage is complete", not table grants) but which no
-- migration ever actually issued. A cross-check of every `GRANT ... ON
-- TABLE` statement in this history against every `CREATE POLICY` found
-- exactly one table (`card_browse`, a view) with a matching explicit
-- grant -- everything else, across the whole schema, was relying on a
-- grant that exists only on the live project (almost certainly applied by
-- hand, once, outside any migration, the same way `rls_auto_enable()` and
-- the `seed_demo_catalogue` fixtures did -- see the two migrations
-- immediately before this one). It happened to go unnoticed because the
-- application itself reaches nearly every table through either a
-- `SECURITY DEFINER` function (which runs as its owner, bypassing grants
-- entirely) or a service-role connection (which Supabase's own bootstrap
-- does grant broadly) -- and because pgTAP was never actually run through
-- a full fresh reset in CI until the previous migration made that possible.
--
-- Every grant below was derived mechanically from this table's own
-- existing `CREATE POLICY` statements (a script cross-referencing
-- `for <cmd> ... to <role>` across every migration file), not decided
-- freshly here -- so it grants exactly the operations each table's
-- policies already intend to permit for `anon`/`authenticated`, nothing
-- broader. Deliberately does NOT touch function `EXECUTE` grants (those
-- are individually and carefully managed throughout this migration
-- history, several as recently as this same security-hardening pass) or
-- `service_role` (already works without these, confirming it has its own,
-- separate baseline).

-- Reference/catalogue data (public read).
grant select on artists to anon, authenticated;
grant select on card_images to anon, authenticated;
grant select on card_legalities to anon, authenticated;
grant select on card_printings to anon, authenticated;
grant select on conditions to anon, authenticated;
grant select on finishes to anon, authenticated;
grant select on formats to anon, authenticated;
grant select on games to anon, authenticated;
grant select on languages to anon, authenticated;
grant select on oracle_cards to anon, authenticated;
grant select on product_statuses to anon, authenticated;
grant select on sellable_skus to anon, authenticated;
grant select on sets to anon, authenticated;
grant select on shipment_carriers to anon, authenticated;

-- Catalogue import/pricing internals (staff-readable only).
grant select on card_identifiers to authenticated;
grant select on calculated_price_inputs to authenticated;
grant select, update on calculated_prices to authenticated;
grant select on catalogue_import_errors to authenticated;
grant select on catalogue_import_runs to authenticated;
grant select on exchange_rates to authenticated;
grant select on price_import_errors to authenticated;
grant select on price_import_runs to authenticated;
grant select on price_snapshots to authenticated;
grant select on price_sources to authenticated;
grant select on pricing_condition_modifiers to authenticated;
grant select on pricing_rules to authenticated;
grant select on pricing_stock_modifiers to authenticated;
grant select on published_price_overrides to authenticated;

-- Storefront-facing pricing/inventory availability (public read).
grant select on fulfilment_nodes to anon, authenticated;
grant select on inventory_balances to anon, authenticated;
grant select on published_prices to anon, authenticated;
grant select on store_addresses to anon, authenticated;

-- Inventory internals (staff-readable only; writes go through the atomic
-- SECURITY DEFINER functions, per AGENTS.md rule 2/12, never a raw grant).
grant select on inventory_allocations to authenticated;
grant select on inventory_movements to authenticated;
grant select on inventory_reservations to authenticated;
grant select on quarantined_inventory to authenticated;

-- Carts and checkout.
grant select on addresses to authenticated;
grant select on cart_lines to authenticated;
grant select on carts to authenticated;
grant select on order_allocations to authenticated;
grant select on order_lines to authenticated;
grant select on orders to authenticated;
grant select on shipments to authenticated;
grant select on stripe_events to authenticated;

-- Organisations/staff.
grant select on organisations to authenticated;
grant select on permissions to authenticated;
grant select on role_permissions to authenticated;
grant select on roles to authenticated;
grant select on staff_membership_nodes to authenticated;
grant select on staff_memberships to authenticated;
grant select on storage_locations to authenticated;
grant select on store_hours to authenticated;

-- Staff fulfilment workflow (picking/packing/handover/stocktakes/transfers).
grant insert, select on order_handovers to authenticated;
grant insert, select, update on packing_shipments to authenticated;
grant insert, select, update on pick_batches to authenticated;
grant select on pick_exception_types to anon, authenticated;
grant insert, select, update on pick_exceptions to authenticated;
grant insert, select, update on pick_lines to authenticated;
grant insert, select, update on stocktake_lines to authenticated;
grant insert, select, update on stocktakes to authenticated;
grant insert, select on transfer_order_lines to authenticated;
grant insert, select, update on transfer_orders to authenticated;
grant select on transfer_receipts to authenticated;
grant select on transfer_shipments to authenticated;

-- Customer-owned data.
grant select, insert, update, delete on customer_addresses to authenticated;
grant select, insert, delete on price_alerts to authenticated;
grant select, insert, update on profiles to authenticated;
grant select, insert, delete on restock_alerts to authenticated;
grant select, insert, delete on saved_list_lines to authenticated;
grant select, insert, update, delete on saved_lists to authenticated;

-- Audit trail (staff-readable only; written exclusively by
-- record_audit_event(), a SECURITY DEFINER function -- see docs/security.md's
-- "Audit trail" section).
grant select on audit_events to authenticated;
