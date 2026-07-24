-- Data remediation, companion to 20260725030000_fix_reservation_release_race_condition.sql.
--
-- After fixing the check-then-lock race, release_expired_reservations() was
-- still only clearing a fraction of its backlog (177 of the first 500-row
-- batch). Root cause: 13,314 of the ~21k stuck 'active' reservations have no
-- matching inventory_balances row at all for their (fulfilment_node_id,
-- sellable_sku_id) pair -- they were never created via reserve_inventory()
-- (which calls lock_inventory_balance() up front, guaranteeing a balance row
-- exists before the reservation does), so nothing ever incremented a real
-- quantity_reserved for them. Calling release_inventory_reservation() on one
-- of these still fails: lock_inventory_balance() auto-creates a fresh
-- zero-value balance row (`insert ... on conflict do nothing`), and the
-- subsequent `quantity_reserved - v_reservation.quantity` then goes
-- negative against that fresh zero row.
--
-- Per AGENTS.md rule 12 (balances are derived from inventory_movements, not
-- editable fields), the correct fix for these rows is not to force a
-- balance adjustment through release_inventory_reservation() -- there is no
-- real reservation on any balance to undo. Expire them directly: this only
-- touches inventory_reservations.status, not any inventory_balances row.
update inventory_reservations
set status = 'expired', updated_at = now()
where status = 'active'
  and expires_at < now()
  and not exists (
    select 1 from inventory_balances b
    where b.fulfilment_node_id = inventory_reservations.fulfilment_node_id
      and b.sellable_sku_id = inventory_reservations.sellable_sku_id
  );
