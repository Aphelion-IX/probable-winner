-- Demo retailer: 1 organisation, 4 Victorian regional stores, no separate
-- warehouse node. All 4 support click-and-collect, online fulfilment, and
-- store-to-store transfers -- there is no single designated hub. Matches
-- blueprint §1/§4 seed list for fulfilment-node topology.
--
-- NOTE: staff user seeding (admin, store manager, pricing user) is
-- intentionally NOT done here. staff_memberships.user_id references
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
  ('Geelong', 'STR-01', 'store', 'VIC', true, true),
  ('Bendigo', 'STR-02', 'store', 'VIC', true, true),
  ('Werribee', 'STR-03', 'store', 'VIC', true, true),
  ('Ballarat', 'STR-04', 'store', 'VIC', true, true)
) as v(name, code, type, region, click_collect, online)
on conflict do nothing;
