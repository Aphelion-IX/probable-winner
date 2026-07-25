-- Seeds the full role x permission matrix (blueprint §18, backlog Step 4).
--
-- 20260724221000_seed_pricing_role_permissions.sql seeded only the
-- pricing.* rows needed to unblock B-163's review queue, and explicitly
-- deferred the rest: "The full role x permission matrix across every other
-- domain (catalogue, inventory, orders, stores, users) is still empty and
-- needs its own deliberate pass." This is that pass.
--
-- Until now staff_has_permission() returned false for every non-pricing
-- permission, for every role including owner/system_admin -- so any staff
-- surface gated on inventory.*, orders.*, stores.* or users.* was
-- unreachable no matter who signed in. The staff inventory/receiving/
-- transfers/customers/stores/settings screens added alongside this
-- migration all depend on these grants.
--
-- Shape of the matrix:
--   * 'customer' is deliberately granted nothing -- it exists as a role
--     code for account rows, not as a staff role.
--   * owner and system_admin get every permission (set-based below, so
--     future permissions are picked up by re-running this insert rather
--     than silently missing).
--   * every other role is least-privilege for its job: view/act on what it
--     operates, no grants for domains it does not own.

-- Roles that get everything. Written as a select over permissions rather
-- than a literal list so a future permission added to the permissions table
-- only needs this statement re-run, not re-authored.
insert into role_permissions (role_code, permission_code)
select 'owner', code from permissions
union all
select 'system_admin', code from permissions
on conflict do nothing;

-- Regional managers run multiple stores end to end: everything except
-- pricing.override, which stays with pricing specialists (and the two
-- all-permission roles above) because it bypasses the calculated price
-- rather than approving it.
insert into role_permissions (role_code, permission_code)
select 'regional_manager', code from permissions
where code not in ('pricing.override')
on conflict do nothing;

insert into role_permissions (role_code, permission_code)
values
  -- Shop floor: sells and fulfils, does not adjust stock or manage staff.
  ('store_assistant', 'catalogue.view'),
  ('store_assistant', 'inventory.view'),
  ('store_assistant', 'inventory.receive'),
  ('store_assistant', 'orders.view'),
  ('store_assistant', 'orders.pick'),
  ('store_assistant', 'orders.pack'),
  ('store_assistant', 'pricing.view'),
  ('store_assistant', 'stores.view'),

  -- Store manager: the assistant's remit plus stock corrections, refunds
  -- and cancellations, and visibility of who works there.
  ('store_manager', 'catalogue.view'),
  ('store_manager', 'catalogue.manage'),
  ('store_manager', 'inventory.view'),
  ('store_manager', 'inventory.receive'),
  ('store_manager', 'inventory.adjust'),
  ('store_manager', 'inventory.transfer'),
  ('store_manager', 'inventory.stocktake'),
  ('store_manager', 'orders.view'),
  ('store_manager', 'orders.pick'),
  ('store_manager', 'orders.pack'),
  ('store_manager', 'orders.refund'),
  ('store_manager', 'orders.cancel'),
  ('store_manager', 'pricing.view'),
  ('store_manager', 'stores.view'),
  ('store_manager', 'users.view'),

  -- Picker: reads the catalogue and works the pick/pack queue. No stock
  -- corrections -- an unexpected count becomes a pick exception, not an
  -- adjustment (blueprint §13.4).
  ('warehouse_picker', 'catalogue.view'),
  ('warehouse_picker', 'inventory.view'),
  ('warehouse_picker', 'orders.view'),
  ('warehouse_picker', 'orders.pick'),
  ('warehouse_picker', 'orders.pack'),

  ('warehouse_manager', 'catalogue.view'),
  ('warehouse_manager', 'inventory.view'),
  ('warehouse_manager', 'inventory.receive'),
  ('warehouse_manager', 'inventory.adjust'),
  ('warehouse_manager', 'inventory.transfer'),
  ('warehouse_manager', 'inventory.stocktake'),
  ('warehouse_manager', 'orders.view'),
  ('warehouse_manager', 'orders.pick'),
  ('warehouse_manager', 'orders.pack'),
  ('warehouse_manager', 'orders.refund'),
  ('warehouse_manager', 'orders.cancel'),
  ('warehouse_manager', 'stores.view'),
  ('warehouse_manager', 'users.view'),

  -- Owns stock accuracy across nodes, including the catalogue rows stock
  -- hangs off. No order-fulfilment or staff-management grants.
  ('inventory_manager', 'catalogue.view'),
  ('inventory_manager', 'catalogue.manage'),
  ('inventory_manager', 'inventory.view'),
  ('inventory_manager', 'inventory.receive'),
  ('inventory_manager', 'inventory.adjust'),
  ('inventory_manager', 'inventory.transfer'),
  ('inventory_manager', 'inventory.stocktake'),
  ('inventory_manager', 'orders.view'),
  ('inventory_manager', 'stores.view'),

  -- pricing.* already granted by 20260724221000; these are the read grants
  -- that make the pricing screens usable (seeing which card and how much
  -- stock sits behind a suggested price).
  ('pricing_manager', 'catalogue.view'),
  ('pricing_manager', 'inventory.view'),
  ('pricing_manager', 'stores.view'),

  -- Customer service: looks customers up, reads their orders, and can
  -- refund or cancel. Never touches stock levels or pricing.
  ('customer_service', 'catalogue.view'),
  ('customer_service', 'inventory.view'),
  ('customer_service', 'orders.view'),
  ('customer_service', 'orders.refund'),
  ('customer_service', 'orders.cancel'),
  ('customer_service', 'pricing.view'),
  ('customer_service', 'stores.view'),
  ('customer_service', 'users.view')
on conflict do nothing;
