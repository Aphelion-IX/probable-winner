-- Helper: does the current user have an active membership granting access
-- to the given fulfilment node, under any scope type?
create or replace function staff_has_node_access(target_node_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from staff_memberships m
    join fulfilment_nodes target on target.id = target_node_id
    where m.user_id = auth.uid()
      and m.active
      and m.organisation_id = target.organisation_id
      and (
        m.scope_type in ('all_stores', 'organisation')
        or (m.scope_type = 'store' and m.fulfilment_node_id = target_node_id)
        or (m.scope_type = 'region' and m.region = target.region)
        or (
          m.scope_type = 'selected_stores'
          and exists (
            select 1 from staff_membership_nodes smn
            where smn.membership_id = m.id and smn.fulfilment_node_id = target_node_id
          )
        )
      )
  );
$$;

-- Helper: does the current user have any active membership in the given org?
create or replace function staff_has_org_access(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from staff_memberships m
    where m.user_id = auth.uid()
      and m.active
      and m.organisation_id = target_org_id
  );
$$;

alter table organisations enable row level security;
alter table fulfilment_nodes enable row level security;
alter table store_addresses enable row level security;
alter table store_hours enable row level security;
alter table storage_locations enable row level security;
alter table staff_memberships enable row level security;
alter table staff_membership_nodes enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;

create policy organisations_select on organisations
  for select to authenticated
  using (staff_has_org_access(id));

create policy fulfilment_nodes_select on fulfilment_nodes
  for select to authenticated
  using (staff_has_node_access(id));

create policy store_addresses_select on store_addresses
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy store_hours_select on store_hours
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy storage_locations_select on storage_locations
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy staff_memberships_select on staff_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or staff_has_org_access(organisation_id)
      and exists (
        select 1 from staff_memberships admin_m
        where admin_m.user_id = auth.uid()
          and admin_m.active
          and admin_m.organisation_id = staff_memberships.organisation_id
          and admin_m.scope_type in ('all_stores', 'organisation')
      )
  );

create policy staff_membership_nodes_select on staff_membership_nodes
  for select to authenticated
  using (
    exists (
      select 1 from staff_memberships m
      where m.id = staff_membership_nodes.membership_id
        and m.user_id = auth.uid()
    )
    or exists (
      select 1 from staff_memberships m
      join staff_memberships admin_m on admin_m.organisation_id = m.organisation_id
      where m.id = staff_membership_nodes.membership_id
        and admin_m.user_id = auth.uid()
        and admin_m.active
        and admin_m.scope_type in ('all_stores', 'organisation')
    )
  );

-- Reference/lookup tables: readable by any authenticated staff member.
create policy roles_select on roles for select to authenticated using (true);
create policy permissions_select on permissions for select to authenticated using (true);
create policy role_permissions_select on role_permissions for select to authenticated using (true);
