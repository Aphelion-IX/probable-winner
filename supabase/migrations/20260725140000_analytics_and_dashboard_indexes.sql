-- Covering indexes for the staff analytics/dashboard queries
-- (apps/web/src/features/staff/actions/{get-analytics,get-dashboard-stats}.ts):
-- these read paths filter on columns that had no supporting index, so each
-- request forced a sequential scan that gets slower as the tables grow.

-- order_lines/calculated_prices: both queried with a plain
-- `created_at >= (now() - 30 days)` filter for the analytics dashboard's
-- rolling window, same style as orders_created_idx/pick_batches_created_idx.
create index if not exists order_lines_created_idx on order_lines (created_at desc);
create index if not exists calculated_prices_created_idx on calculated_prices (created_at desc);

-- pick_batches: the staff dashboard's "active pick batches" count filters
-- on status alone (no fulfilment_node_id predicate), which
-- pick_batches_node_status_idx's leading column doesn't serve. Partial on
-- the two non-terminal statuses, same "active-only" style as
-- inventory_reservations_active_node_sku_idx / pick_exceptions_unresolved_idx.
create index if not exists pick_batches_active_idx on pick_batches (status)
  where status in ('pending', 'in_progress');
