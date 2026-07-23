-- Packing workflow for order fulfillment (backlog B-144).
-- Tracks packing of completed pick batches into shipments with carrier labels.

create table shipment_carriers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

insert into shipment_carriers (code, name) values
  ('auspost', 'Australia Post'),
  ('startrack', 'StarTrack'),
  ('fedex', 'FedEx'),
  ('dhl', 'DHL'),
  ('courier', 'Local Courier');

create table shipments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  pick_batch_id uuid not null references pick_batches(id) on delete restrict,
  carrier_id uuid references shipment_carriers(id),
  status text not null check (status in ('pending', 'packed', 'labeled', 'ready_to_ship', 'shipped', 'cancelled'))
    default 'pending',
  tracking_number text,
  weight_kg numeric(10,2),
  dimensions text, -- JSON: {length_cm, width_cm, height_cm}
  cost_amount integer, -- cents
  cost_currency text,
  label_url text, -- URL to printed label document
  shipped_at timestamptz,
  packed_at timestamptz,
  packed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_batch_idx on shipments (pick_batch_id);
create index shipments_status_idx on shipments (status);
create index shipments_carrier_idx on shipments (carrier_id);
create index shipments_organisation_idx on shipments (organisation_id, status);
create index shipments_created_idx on shipments (created_at desc);

-- RLS: scoped by node membership via pick_batch → fulfilment_node
alter table shipments enable row level security;

create policy shipments_select on shipments
  for select to authenticated
  using (
    exists (
      select 1 from pick_batches pb
      where pb.id = shipments.pick_batch_id
        and staff_has_node_access(pb.fulfilment_node_id)
    )
  );

create policy shipments_insert on shipments
  for insert to authenticated
  with check (
    exists (
      select 1 from pick_batches pb
      where pb.id = shipments.pick_batch_id
        and staff_has_node_access(pb.fulfilment_node_id)
    )
  );

create policy shipments_update on shipments
  for update to authenticated
  using (
    exists (
      select 1 from pick_batches pb
      where pb.id = shipments.pick_batch_id
        and staff_has_node_access(pb.fulfilment_node_id)
    )
  );

-- Helper: create shipment from completed batch
create or replace function create_shipment(
  p_pick_batch_id uuid,
  p_carrier_code text default null
)
returns shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch pick_batches;
  v_shipment shipments;
  v_carrier_id uuid;
  v_org_id uuid;
begin
  select * into v_batch from pick_batches where id = p_pick_batch_id;
  if v_batch is null then
    raise exception 'create_shipment: unknown batch %', p_pick_batch_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'create_shipment: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  select organisation_id into v_org_id from fulfilment_nodes where id = v_batch.fulfilment_node_id;

  if p_carrier_code is not null then
    select id into v_carrier_id from shipment_carriers where code = p_carrier_code;
    if v_carrier_id is null then
      raise exception 'create_shipment: unknown carrier %', p_carrier_code;
    end if;
  end if;

  insert into shipments (
    organisation_id, pick_batch_id, carrier_id, packed_by_user_id, packed_at
  ) values (
    v_org_id, p_pick_batch_id, v_carrier_id, auth.uid(), now()
  )
  returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke execute on function create_shipment(uuid, text) from public, anon;
grant execute on function create_shipment(uuid, text) to authenticated;

-- Helper: generate shipping label and mark as ready
create or replace function generate_shipment_label(
  p_shipment_id uuid,
  p_tracking_number text default null,
  p_label_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment shipments;
begin
  select * into v_shipment from shipments where id = p_shipment_id;
  if v_shipment is null then
    raise exception 'generate_shipment_label: unknown shipment %', p_shipment_id;
  end if;

  -- Verify access
  if not exists (
    select 1 from pick_batches pb
    where pb.id = v_shipment.pick_batch_id
      and staff_has_node_access(pb.fulfilment_node_id)
  ) then
    raise exception 'generate_shipment_label: access denied for shipment %', p_shipment_id
      using errcode = '42501';
  end if;

  update shipments
  set
    status = 'labeled',
    tracking_number = p_tracking_number,
    label_url = p_label_url,
    updated_at = now()
  where id = p_shipment_id;
end;
$$;

revoke execute on function generate_shipment_label(uuid, text, text) from public, anon;
grant execute on function generate_shipment_label(uuid, text, text) to authenticated;

-- Helper: mark shipment as shipped
create or replace function mark_shipment_shipped(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment shipments;
begin
  select * into v_shipment from shipments where id = p_shipment_id;
  if v_shipment is null then
    raise exception 'mark_shipment_shipped: unknown shipment %', p_shipment_id;
  end if;

  if not exists (
    select 1 from pick_batches pb
    where pb.id = v_shipment.pick_batch_id
      and staff_has_node_access(pb.fulfilment_node_id)
  ) then
    raise exception 'mark_shipment_shipped: access denied for shipment %', p_shipment_id
      using errcode = '42501';
  end if;

  update shipments
  set status = 'shipped', shipped_at = now(), updated_at = now()
  where id = p_shipment_id;
end;
$$;

revoke execute on function mark_shipment_shipped(uuid) from public, anon;
grant execute on function mark_shipment_shipped(uuid) to authenticated;
