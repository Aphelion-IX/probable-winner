-- Demo retailer: 1 organisation, 1 central warehouse, 10 stores.
-- Matches blueprint §4 seed list for fulfilment-node topology.
--
-- NOTE: staff user seeding (admin, store manager, warehouse user, pricing
-- user) is intentionally NOT done here. staff_memberships.user_id references
-- auth.users, which is managed by Supabase Auth — creating real auth users
-- requires the Auth Admin API or the dashboard, not a raw SQL insert. Create
-- the demo staff accounts first (Supabase Studio > Authentication, or
-- `supabase.auth.admin.createUser`), then fill in the user ids in
-- seed_staff.sql.example and run it.

with org as (
  insert into organisations (name) values ('Demo Card Retailer')
  returning id
)
insert into fulfilment_nodes (
  organisation_id, name, code, type, region, timezone, active,
  allows_click_collect, allows_online_fulfilment, allows_transfers
)
select
  org.id, v.name, v.code, v.type, v.region, 'Australia/Melbourne', true,
  v.click_collect, v.online, true
from org, (values
  ('Central Warehouse', 'WH-01', 'warehouse', null, false, true),
  ('Melbourne CBD', 'STR-01', 'store', 'VIC', true, true),
  ('Frankston', 'STR-02', 'store', 'VIC', true, true),
  ('Geelong', 'STR-03', 'store', 'VIC', true, true),
  ('Sydney CBD', 'STR-04', 'store', 'NSW', true, true),
  ('Parramatta', 'STR-05', 'store', 'NSW', true, true),
  ('Brisbane CBD', 'STR-06', 'store', 'QLD', true, true),
  ('Gold Coast', 'STR-07', 'store', 'QLD', true, true),
  ('Adelaide CBD', 'STR-08', 'store', 'SA', true, true),
  ('Perth CBD', 'STR-09', 'store', 'WA', true, true),
  ('Canberra', 'STR-10', 'store', 'ACT', true, true)
) as v(name, code, type, region, click_collect, online)
on conflict do nothing;
