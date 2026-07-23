-- RECONCILIATION NOTE: pulled verbatim from the live project's migration
-- history (see 20260723064823_fix_transfer_status_transitions.sql for why).

-- Addresses table for shipping and customer contact information
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  recipient_name text not null,
  line_1 text not null,
  line_2 text,
  suburb_city text not null,
  state_province text not null,
  postcode_zip text not null,
  country_code text not null,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index addresses_org_idx on addresses (organisation_id);
create index addresses_created_idx on addresses (created_at desc);

alter table addresses enable row level security;

create policy addresses_select on addresses
  for select to authenticated
  using (
    organisation_id in (
      select organisation_id from staff_memberships
      where user_id = auth.uid() and active
    )
  );
