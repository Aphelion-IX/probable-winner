-- Two RLS gaps found while wiring up Google/Apple OAuth sign-in.
--
-- 1. profiles had no INSERT policy at all.
--
-- 20260724180000 created profiles with SELECT and UPDATE policies only, and
-- said so deliberately: "No insert policy: rows are created only by
-- handle_new_customer() below, on signup, via a security-definer trigger --
-- never directly by the client."
--
-- That trigger is still the normal path and stays exactly as it is. The
-- problem is that it is the *only* path: it fires on `insert on auth.users`,
-- so any account whose row did not get created -- an account predating the
-- trigger, or one where the insert failed -- is permanently stuck. The user
-- has no profile, cannot create one, and every screen that reads
-- `profiles` fails for them forever with no recovery short of manual DBA
-- intervention. The OAuth callback needs a backstop it is allowed to use.
--
-- The policy is scoped to the caller's own row (`id = auth.uid()`), so the
-- worst it permits is a user creating their own missing profile. `profiles`
-- holds no role, permission or entitlement column -- display name, phone and
-- preferred store -- so self-insert grants no privilege. Internal access
-- lives in staff_memberships, which is unaffected and remains read-only to
-- everyone (no INSERT/UPDATE/DELETE policy exists on it).
--
-- 2. saved_lists could be created but never updated or deleted.
--
-- 20260725150000 gave saved_lists SELECT and INSERT policies, and gave
-- saved_list_lines all of SELECT/INSERT/DELETE. The parent table was left
-- without UPDATE or DELETE, so a customer can create a saved list and add or
-- remove cards in it, but can never rename it and can never delete it --
-- their own rows, permanently undeletable. With RLS on and no policy for a
-- command, Postgres denies it, so this fails closed rather than loudly, which
-- is why it went unnoticed.
--
-- Both policies use `(select auth.uid())` rather than a bare `auth.uid()`,
-- matching 20260724143308_fix_rls_performance_lints: the subquery form is
-- evaluated once per statement as an InitPlan instead of once per row.

create policy profiles_insert_self on profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

-- USING decides which rows may be updated; WITH CHECK decides what they may
-- be updated *to*. Both are required: USING alone would let a customer take
-- ownership of their list by rewriting customer_id to someone else's id.
create policy saved_lists_update on saved_lists
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

create policy saved_lists_delete on saved_lists
  for delete to authenticated
  using (customer_id = (select auth.uid()));
