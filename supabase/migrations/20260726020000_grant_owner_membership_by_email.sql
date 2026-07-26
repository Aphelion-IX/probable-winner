-- Grants the owner role to the founding administrator, resolved by email
-- rather than by a hardcoded auth.users id.
--
-- WHY BY EMAIL
--
-- staff_memberships.user_id references auth.users(id), which Supabase Auth
-- owns and which is generated per project. Writing a literal uuid here would
-- bind this migration to one specific database: on any rebuild, or on a
-- second environment, that id does not exist and the insert fails on the
-- foreign key. An email address is the one stable identifier that survives a
-- rebuild, so the lookup happens at migration time against whatever id the
-- account actually has.
--
-- This is the same grant that supabase/seed_staff.sql.example describes for
-- the demo accounts. That file stays as it is -- it covers four demo staff
-- with placeholder ids and is meant to be run by hand. This migration covers
-- only the one real administrator account, so that a fresh deploy is not left
-- with a database nobody can administer.
--
-- IMPORTANT LIMITATION
--
-- Migrations run once, and this one depends on data Supabase Auth owns. If
-- the account does not exist when the migration runs -- a brand-new project
-- where nobody has signed up yet -- there is nothing to grant, and the
-- migration succeeds having done nothing. It will not retroactively fire when
-- the account is later created.
--
-- On a fresh environment the order therefore matters:
--   1. run migrations
--   2. sign in once at /login to create the auth account
--   3. run the insert below by hand (or via seed_staff.sql.example)
--
-- The RAISE NOTICE exists so that "did nothing" is visible in the migration
-- output rather than silent. A silent no-op here means no one can reach the
-- staff portal, which is a confusing thing to debug later.
--
-- IDEMPOTENT
--
-- staff_memberships has no unique constraint across
-- (user_id, organisation_id, role_code) -- a user may legitimately hold
-- several memberships, including two roles in one organisation -- so
-- `on conflict` has nothing to key on. Duplicate protection is an explicit
-- NOT EXISTS instead. Re-running this is therefore safe, and it is a no-op
-- against the live database where the grant already exists.

do $$
declare
  v_user_id uuid;
  v_organisation_id uuid;
  v_email constant text := 's.hale@outlook.com.au';
  v_organisation constant text := 'Demo Card Retailer';
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    raise notice 'grant_owner_membership_by_email: no auth user for %, skipping. Sign in once, then grant the membership by hand.', v_email;
    return;
  end if;

  -- Looked up by name rather than by id for the same reason as the user:
  -- organisations are not created by any migration, so the id is not stable
  -- across environments.
  select id into v_organisation_id from organisations where name = v_organisation;

  if v_organisation_id is null then
    raise notice 'grant_owner_membership_by_email: organisation % not found, skipping.', v_organisation;
    return;
  end if;

  if exists (
    select 1 from staff_memberships
    where user_id = v_user_id
      and organisation_id = v_organisation_id
      and role_code = 'owner'
  ) then
    raise notice 'grant_owner_membership_by_email: % already holds owner, skipping.', v_email;
    return;
  end if;

  -- scope_type 'organisation' rather than 'store': the owner should see every
  -- fulfilment node, and the store_scope_check constraint requires
  -- fulfilment_node_id to be null for any scope other than 'store'.
  insert into staff_memberships (organisation_id, user_id, role_code, scope_type, active)
  values (v_organisation_id, v_user_id, 'owner', 'organisation', true);

  raise notice 'grant_owner_membership_by_email: granted owner to %.', v_email;
end;
$$;
