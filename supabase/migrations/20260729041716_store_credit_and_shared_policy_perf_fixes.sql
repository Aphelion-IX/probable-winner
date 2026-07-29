-- Three mechanical RLS/index fixes surfaced by the Supabase performance
-- advisor (get_advisors), all account/staff-domain (store credit, customer
-- addresses, profiles) rather than the anonymous browse hot path already
-- optimised elsewhere in this session -- smaller audience, but real and
-- risk-free to fix.

-- 1. auth_rls_initplan: these two policies called auth.uid() directly
-- inside the row-level qual, which Postgres re-evaluates for every row
-- scanned. Wrapping it in a scalar subquery (select auth.uid()) lets the
-- planner hoist it into an InitPlan and evaluate it once per query instead
-- -- see https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select.
-- staff_has_permission(...) is left as-is: the advisor only flags the
-- literal auth.<function>()/current_setting() pattern, not custom
-- functions, and this migration only fixes what was actually flagged.
alter policy store_credit_accounts_select on store_credit_accounts
using (
  (customer_id = (select auth.uid())) or staff_has_permission('customers.credit')
);

alter policy store_credit_ledger_select on store_credit_ledger
using (
  (exists (
    select 1
    from store_credit_accounts a
    where a.id = store_credit_ledger.store_credit_account_id
      and a.customer_id = (select auth.uid())
  )) or staff_has_permission('customers.credit')
);

-- 2. unindexed_foreign_keys: store_credit_ledger.staff_user_id (who
-- issued/adjusted a credit) had no covering index, so any query filtering
-- or joining on it (e.g. a staff audit view of "credits issued by me")
-- would need a sequential scan.
create index if not exists store_credit_ledger_staff_user_id_idx
on store_credit_ledger (staff_user_id);

-- 3. multiple_permissive_policies: customer_addresses and profiles each had
-- two separate permissive SELECT policies for `authenticated` (a
-- customer-owns-it check and a staff-permission check), which Postgres
-- evaluates as two independent predicates ORed together per row instead of
-- one combined expression. Merging them into a single policy per table is
-- behaviourally identical (permissive policies already OR together) but
-- cheaper to evaluate. auth.uid() stays wrapped in the scalar-subquery form
-- these policies already used (not flagged by auth_rls_initplan, already
-- correct).
drop policy customer_addresses_select on customer_addresses;
drop policy customer_addresses_select_staff on customer_addresses;
create policy customer_addresses_select on customer_addresses
for select to authenticated
using (
  (customer_id = (select auth.uid())) or staff_has_permission('users.view')
);

drop policy profiles_select on profiles;
drop policy profiles_select_staff on profiles;
create policy profiles_select on profiles
for select to authenticated
using (
  (id = (select auth.uid())) or staff_has_permission('users.view')
);
