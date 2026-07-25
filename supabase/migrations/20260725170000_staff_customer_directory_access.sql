-- Staff read access to the customer directory (backlog Step 18, the staff
-- "Customers" screen).
--
-- 20260724180000_customer_profiles_and_addresses.sql locked profiles and
-- customer_addresses to "the customer, and only their own row"
-- (id = auth.uid() / customer_id = auth.uid()). That is right for the
-- storefront but leaves customer-service staff unable to read the record of
-- the customer they are on the phone to -- orders were already staff-
-- readable via orders_select_staff, so staff could see an order but not who
-- placed it.
--
-- Gate is the existing users.view permission (blueprint §18), which is
-- exactly "may see people records" and is granted to customer_service,
-- store_manager, warehouse_manager, regional_manager, owner and
-- system_admin by 20260725160000. Deliberately NOT restricted further to
-- "customers who have an order at one of my nodes": customer service
-- routinely handles pre-order enquiries and account problems for people
-- with no order history yet, and a scoped-by-order policy would make those
-- customers invisible precisely when someone is trying to help them.
--
-- Read-only: no staff insert/update/delete policy is added. Customers
-- remain the only writers of their own profile and addresses, so this
-- cannot become a back door for editing someone's account.

create policy profiles_select_staff on profiles
  for select to authenticated
  using (staff_has_permission('users.view'));

create policy customer_addresses_select_staff on customer_addresses
  for select to authenticated
  using (staff_has_permission('users.view'));
