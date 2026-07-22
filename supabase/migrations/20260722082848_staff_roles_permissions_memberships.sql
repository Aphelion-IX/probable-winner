create table roles (
  code text primary key,
  description text not null
);

create table permissions (
  code text primary key,
  description text not null
);

create table role_permissions (
  role_code text not null references roles(code) on delete cascade,
  permission_code text not null references permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table staff_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_code text not null references roles(code),
  scope_type text not null check (scope_type in ('store', 'selected_stores', 'region', 'all_stores', 'organisation')),
  fulfilment_node_id uuid references fulfilment_nodes(id) on delete cascade,
  region text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint staff_memberships_store_scope_check check (
    (scope_type = 'store' and fulfilment_node_id is not null)
    or (scope_type <> 'store' and fulfilment_node_id is null)
  ),
  constraint staff_memberships_region_scope_check check (
    (scope_type = 'region' and region is not null)
    or (scope_type <> 'region' and region is null)
  )
);

create index staff_memberships_user_org_node_idx on staff_memberships (user_id, organisation_id, fulfilment_node_id);
create index staff_memberships_org_idx on staff_memberships (organisation_id);

create table staff_membership_nodes (
  membership_id uuid not null references staff_memberships(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  primary key (membership_id, fulfilment_node_id)
);

create index staff_membership_nodes_node_idx on staff_membership_nodes (fulfilment_node_id);

insert into roles (code, description) values
  ('customer', 'Customer account'),
  ('store_assistant', 'Store assistant'),
  ('store_manager', 'Store manager'),
  ('warehouse_picker', 'Warehouse picker'),
  ('warehouse_manager', 'Warehouse manager'),
  ('inventory_manager', 'Inventory manager'),
  ('pricing_manager', 'Pricing manager'),
  ('customer_service', 'Customer service'),
  ('regional_manager', 'Regional manager'),
  ('system_admin', 'System administrator'),
  ('owner', 'Organisation owner');

insert into permissions (code, description) values
  ('catalogue.view', 'View catalogue'),
  ('catalogue.manage', 'Manage catalogue'),
  ('inventory.view', 'View inventory'),
  ('inventory.receive', 'Receive inventory'),
  ('inventory.adjust', 'Adjust inventory'),
  ('inventory.transfer', 'Transfer inventory'),
  ('inventory.stocktake', 'Perform stocktakes'),
  ('orders.view', 'View orders'),
  ('orders.pick', 'Pick orders'),
  ('orders.pack', 'Pack orders'),
  ('orders.refund', 'Refund orders'),
  ('orders.cancel', 'Cancel orders'),
  ('pricing.view', 'View pricing'),
  ('pricing.approve', 'Approve pricing'),
  ('pricing.override', 'Override pricing'),
  ('stores.view', 'View stores'),
  ('stores.manage', 'Manage stores'),
  ('users.view', 'View users'),
  ('users.manage', 'Manage users');
