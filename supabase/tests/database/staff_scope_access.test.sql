-- pgTAP tests for staff_has_node_access() scope resolution and the
-- staff_memberships store-scope check constraint (backlog B-034).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project during Phase 0
-- (wrapped in BEGIN/ROLLBACK so no fixture data was left behind) — see the
-- commit that added this file for the confirmed pass/fail output.
begin;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store-mgr@test.local'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'regional-mgr@test.local'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'selected-mgr@test.local');

insert into organisations (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Test Org');

insert into fulfilment_nodes (id, organisation_id, name, code, type, region)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Store A', 'A', 'store', 'VIC'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'Store B', 'B', 'store', 'VIC'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', 'Store C', 'C', 'store', 'NSW');

insert into staff_memberships (organisation_id, user_id, role_code, scope_type, fulfilment_node_id)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'store_manager', 'store', '00000000-0000-0000-0000-0000000000a1');

insert into staff_memberships (organisation_id, user_id, role_code, scope_type, region)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', 'regional_manager', 'region', 'VIC');

insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', 'system_admin', 'all_stores');

with m as (
  insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', 'inventory_manager', 'selected_stores')
  returning id
)
insert into staff_membership_nodes (membership_id, fulfilment_node_id)
select m.id, '00000000-0000-0000-0000-0000000000a1'::uuid from m
union all
select m.id, '00000000-0000-0000-0000-0000000000a3'::uuid from m;

-- Store-scoped user: own store yes, other store no.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select ok(staff_has_node_access('00000000-0000-0000-0000-0000000000a1'), 'store-scoped user can access own store');
select ok(not staff_has_node_access('00000000-0000-0000-0000-0000000000a2'), 'store-scoped user cannot access a different store');

-- Region-scoped user: same-region store yes, other-region store no.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select ok(staff_has_node_access('00000000-0000-0000-0000-0000000000a2'), 'region-scoped user can access another store in the same region');
select ok(not staff_has_node_access('00000000-0000-0000-0000-0000000000a3'), 'region-scoped user cannot access a store in a different region');

-- All-stores (admin) user: any store yes.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select ok(staff_has_node_access('00000000-0000-0000-0000-0000000000a3'), 'all-stores-scoped user can access any store in the org');

-- Selected-stores user: listed stores yes, unlisted store no.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select ok(staff_has_node_access('00000000-0000-0000-0000-0000000000a1'), 'selected-stores user can access a listed store (A)');
select ok(staff_has_node_access('00000000-0000-0000-0000-0000000000a3'), 'selected-stores user can access a listed store (C)');
select ok(not staff_has_node_access('00000000-0000-0000-0000-0000000000a2'), 'selected-stores user cannot access an unlisted store (B)');

-- Constraint: store scope requires fulfilment_node_id.
select throws_ok(
  $$insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'store_manager', 'store')$$,
  '23514',
  null,
  'store scope without fulfilment_node_id violates the check constraint'
);

select finish();

rollback;
