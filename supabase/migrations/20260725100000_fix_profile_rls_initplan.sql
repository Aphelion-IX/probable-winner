-- Follow-up to 20260725060000_fix_rls_performance_lints.sql: the customer
-- profiles/addresses policies (20260724180000_customer_profiles_and_addresses.sql)
-- were deployed after that pass, verbatim from the pending local migration,
-- so they still call auth.uid() directly instead of (select auth.uid()).
alter policy profiles_select on profiles
  using (id = (select auth.uid()));

alter policy profiles_update on profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy customer_addresses_select on customer_addresses
  using (customer_id = (select auth.uid()));

alter policy customer_addresses_insert on customer_addresses
  with check (customer_id = (select auth.uid()));

alter policy customer_addresses_update on customer_addresses
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

alter policy customer_addresses_delete on customer_addresses
  using (customer_id = (select auth.uid()));
