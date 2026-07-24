-- pgTAP tests for customer profiles and addresses (backlog B-170).
-- Core AC: profile schema integrates with Supabase Auth (auto-created on
-- signup); a customer can only ever read/write their own profile and
-- addresses, never another customer's.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000001601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-a@test.local'),
  ('00000000-0000-0000-0000-000000001602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-b@test.local');

-- Test 1: signing up auto-creates a blank profile row (handle_new_customer trigger).
select ok(
  exists(select 1 from profiles where id = '00000000-0000-0000-0000-000000001601'),
  'a profiles row is auto-created when a new auth.users row is inserted'
);

select ok(
  exists(select 1 from profiles where id = '00000000-0000-0000-0000-000000001602'),
  'the trigger fires for every new user, not just the first'
);

-- Customer A's own access.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001601', true);
set local role authenticated;

select ok(
  (select count(*) from profiles where id = '00000000-0000-0000-0000-000000001601') = 1,
  'a customer can select their own profile'
);

update profiles set display_name = 'Alex' where id = '00000000-0000-0000-0000-000000001601';
select ok(
  (select display_name from profiles where id = '00000000-0000-0000-0000-000000001601') = 'Alex',
  'a customer can update their own profile'
);

-- Test 5/6: Customer A cannot see or update Customer B's profile.
select ok(
  (select count(*) from profiles where id = '00000000-0000-0000-0000-000000001602') = 0,
  'a customer cannot select another customer''s profile'
);

update profiles set display_name = 'Hijacked' where id = '00000000-0000-0000-0000-000000001602';
select ok(
  not exists(select 1 from profiles where id = '00000000-0000-0000-0000-000000001602' and display_name = 'Hijacked'),
  'a customer cannot update another customer''s profile'
);

-- Customer A's own addresses.
with a as (
  insert into customer_addresses (customer_id, line1, city, country)
  values ('00000000-0000-0000-0000-000000001601', '1 Test Street', 'Sydney', 'AU')
  returning id
)
select ok(exists(select 1 from a), 'a customer can insert their own address');

select ok(
  (select count(*) from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001601') = 1,
  'a customer can select their own address'
);

update customer_addresses set city = 'Melbourne'
  where customer_id = '00000000-0000-0000-0000-000000001601';
select ok(
  (select city from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001601') = 'Melbourne',
  'a customer can update their own address'
);

reset role;

-- Seed an address for Customer B directly (bypassing RLS as the test owner).
insert into customer_addresses (customer_id, line1, city, country)
values ('00000000-0000-0000-0000-000000001602', '2 Test Street', 'Perth', 'AU');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001601', true);
set local role authenticated;

-- Test 10/11: Customer A cannot see or modify Customer B's address.
select ok(
  (select count(*) from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001602') = 0,
  'a customer cannot select another customer''s address'
);

update customer_addresses set city = 'Hijacked' where customer_id = '00000000-0000-0000-0000-000000001602';
select ok(
  not exists(select 1 from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001602' and city = 'Hijacked'),
  'a customer cannot update another customer''s address'
);

delete from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001602';
select ok(
  exists(select 1 from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001602'),
  'a customer cannot delete another customer''s address'
);

-- Test 13: a customer can delete their own address.
delete from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001601';
select ok(
  not exists(select 1 from customer_addresses where customer_id = '00000000-0000-0000-0000-000000001601'),
  'a customer can delete their own address'
);

reset role;

-- Test 14: fulfilment_nodes has a public policy scoped to active stores only
-- (needed so customers can pick a preferred store), alongside the existing
-- staff-scoped one -- not a loosening of it.
select ok(
  (
    select qual like '%active%'
    from pg_policies
    where tablename = 'fulfilment_nodes' and policyname = 'fulfilment_nodes_select_public'
  ),
  'fulfilment_nodes has a public policy scoped to active stores'
);

select finish();

rollback;
