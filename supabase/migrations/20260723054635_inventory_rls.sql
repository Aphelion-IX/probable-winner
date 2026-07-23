-- Inventory data is staff-only (unlike catalogue/sellable_skus): customers
-- see availability via Typesense, synced from this data through the outbox
-- (blueprint §13.1/§17, backlog B-082/B-083), never by querying these tables
-- directly. Scoped by the same staff_has_node_access() helper used for
-- fulfilment_nodes (migration 20260722082907) — a store-scoped staff member
-- only sees their store's balances/movements, an org-scoped one sees all of
-- their org's. No write policies: see the schema migration's comment.

alter table inventory_balances enable row level security;
alter table inventory_movements enable row level security;

create policy inventory_balances_select on inventory_balances
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy inventory_movements_select on inventory_movements
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));
