-- role_permissions (backlog Step 4, blueprint §18) was created and seeded
-- with roles/permissions, but the actual role-to-permission mapping was
-- never populated at all -- the table has zero rows. That means
-- staff_has_permission() has always returned false for every role,
-- including the pricing.approve/pricing.override checks this migration's
-- companion (20260724220000_fix_pricing_review_permissions.sql) just added
-- to approve_suggested_price()/override_suggested_price()/
-- reject_suggested_price(): without this, even a legitimate pricing
-- manager could never approve or override a price.
--
-- Scope: this migration seeds only the pricing.* permissions needed to
-- unblock B-163's review queue. The full role x permission matrix across
-- every other domain (catalogue, inventory, orders, stores, users) is
-- still empty and needs its own deliberate pass -- which roles get which
-- permissions is a product decision, not something to backfill as a side
-- effect of a pricing fix.

insert into role_permissions (role_code, permission_code)
values
  ('pricing_manager', 'pricing.view'),
  ('pricing_manager', 'pricing.approve'),
  ('pricing_manager', 'pricing.override'),
  ('owner', 'pricing.view'),
  ('owner', 'pricing.approve'),
  ('owner', 'pricing.override'),
  ('system_admin', 'pricing.view'),
  ('system_admin', 'pricing.approve'),
  ('system_admin', 'pricing.override')
on conflict do nothing;
