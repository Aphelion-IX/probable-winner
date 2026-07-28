-- pgTAP tests for store_credit_accounts/store_credit_ledger and
-- adjust_store_credit() (blueprint §8.9). Same balance/ledger architecture
-- as inventory_balances/inventory_movements: adjust_store_credit() is the
-- only writer of either table, matching hard rule 12's "never store an
-- editable account-credit balance without a transaction ledger".
--
-- Core AC: applying and removing credit produces a matching ledger row and
-- balance change; removing more than the available balance is rejected
-- rather than allowed to go negative; the tables have no direct write path
-- outside the function.
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(11);

create temp table test_ids_sc (key text primary key, id uuid);
grant select, insert on test_ids_sc to authenticated;

insert into test_ids_sc (key, id) select 'org', id from organisations limit 1;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-customer@test.local'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-staff@test.local'),
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-unprivileged-staff@test.local');

insert into test_ids_sc (key, id) values
  ('customer', '00000000-0000-0000-0000-000000002001'),
  ('staff', '00000000-0000-0000-0000-000000002002'),
  ('unprivileged_staff', '00000000-0000-0000-0000-000000002003');

-- store_manager carries customers.credit (20260728000000); store_assistant
-- does not, per the same migration's role/permission matrix.
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_sc where key = 'org'), (select id from test_ids_sc where key = 'staff'), 'store_manager', 'organisation';
insert into staff_memberships (organisation_id, user_id, role_code, scope_type)
select (select id from test_ids_sc where key = 'org'), (select id from test_ids_sc where key = 'unprivileged_staff'), 'store_assistant', 'organisation';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002002', true);
set local role authenticated;

-- Trade-in: $12.50 credited for the first time -- creates the account.
select adjust_store_credit(
  (select id from test_ids_sc where key = 'customer'),
  12.50, 'trade_in', 'Trade-in: 5 bulk commons'
);

select ok(
  (
    select balance = 12.50 and currency = 'AUD'
    from store_credit_accounts
    where customer_id = (select id from test_ids_sc where key = 'customer')
  ),
  'first credit creates the account with the correct starting balance'
);
select ok(
  (
    select count(*) = 1 from store_credit_ledger l
    join store_credit_accounts a on a.id = l.store_credit_account_id
    where a.customer_id = (select id from test_ids_sc where key = 'customer')
      and l.entry_type = 'trade_in' and l.amount_delta = 12.50
  ),
  'a matching ledger row is written for the trade-in credit'
);

-- Goodwill: another $5.00 on top.
select adjust_store_credit(
  (select id from test_ids_sc where key = 'customer'),
  5.00, 'goodwill', 'Late shipment goodwill credit'
);

select ok(
  (
    select balance = 17.50
    from store_credit_accounts
    where customer_id = (select id from test_ids_sc where key = 'customer')
  ),
  'a second credit accumulates onto the existing balance (12.50 + 5.00 = 17.50)'
);

-- Redemption: remove $8.00.
select adjust_store_credit(
  (select id from test_ids_sc where key = 'customer'),
  -8.00, 'redemption', 'Redeemed at checkout'
);

select ok(
  (
    select balance = 9.50
    from store_credit_accounts
    where customer_id = (select id from test_ids_sc where key = 'customer')
  ),
  'removing credit decrements the balance (17.50 - 8.00 = 9.50)'
);

-- Removing more than the balance holds is rejected, and the balance is
-- unchanged (the check_violation rolls back the whole function call).
select throws_ok(
  format(
    $$select adjust_store_credit('%s', -100.00, 'redemption', 'Attempted over-redemption')$$,
    (select id from test_ids_sc where key = 'customer')
  ),
  '23514',
  null,
  'removing more credit than the account holds is rejected'
);
select ok(
  (
    select balance = 9.50
    from store_credit_accounts
    where customer_id = (select id from test_ids_sc where key = 'customer')
  ),
  'the rejected over-redemption left the balance untouched'
);

-- Validation: zero delta, blank reason, and an unrecognised entry_type are
-- all rejected before anything is written.
select throws_ok(
  format(
    $$select adjust_store_credit('%s', 0, 'correction', 'no-op')$$,
    (select id from test_ids_sc where key = 'customer')
  ),
  null, 'adjust_store_credit: amount_delta must be non-zero',
  'a zero amount_delta is rejected'
);
select throws_ok(
  format(
    $$select adjust_store_credit('%s', 1.00, 'correction', '   ')$$,
    (select id from test_ids_sc where key = 'customer')
  ),
  null, 'adjust_store_credit: a reason is required',
  'a blank reason is rejected'
);
select throws_ok(
  format(
    $$select adjust_store_credit('%s', 1.00, 'bogus_type', 'test')$$,
    (select id from test_ids_sc where key = 'customer')
  ),
  null, 'adjust_store_credit: bogus_type is not a recognised entry_type',
  'an unrecognised entry_type is rejected'
);

-- Permission check: a staff member without customers.credit is refused.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002003', true);
select throws_ok(
  format(
    $$select adjust_store_credit('%s', 1.00, 'goodwill', 'should be refused')$$,
    (select id from test_ids_sc where key = 'customer')
  ),
  '42501',
  null,
  'a staff member without customers.credit is refused'
);

reset role;

-- No direct write path: even a superuser-equivalent role in this test
-- session cannot bypass adjust_store_credit(), since no insert policy (or
-- insert grant) exists on either table for `authenticated`.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002002', true);
select throws_ok(
  format(
    $$insert into store_credit_accounts (organisation_id, customer_id, balance)
      values ('%s', '%s', 999)$$,
    (select id from test_ids_sc where key = 'org'),
    (select id from test_ids_sc where key = 'customer')
  ),
  null,
  null,
  'store_credit_accounts has no direct insert path outside adjust_store_credit()'
);
reset role;

select finish();

rollback;
