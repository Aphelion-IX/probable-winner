-- Pick exceptions and handling (backlog B-143).
-- Tracks exceptions encountered during picking: missing cards, condition mismatches,
-- substitutions, etc. Staff can mark exceptions and escalate to management for resolution.

create table pick_exception_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into pick_exception_types (code, name, description) values
  ('missing_card', 'Card Missing', 'Card not found in expected location'),
  ('condition_mismatch', 'Condition Mismatch', 'Card condition worse than expected'),
  ('wrong_edition', 'Wrong Edition', 'Different edition or printing than ordered'),
  ('damaged_in_picking', 'Damaged During Pick', 'Card damaged while picking'),
  ('substitution_offered', 'Substitution Offered', 'Better condition or version offered to customer');

create table pick_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  pick_line_id uuid not null references pick_lines(id) on delete cascade,
  exception_type_id uuid not null references pick_exception_types(id),
  severity text not null check (severity in ('info', 'warning', 'critical'))
    default 'warning',
  notes text,
  resolution text check (resolution in ('substitute', 'refund', 'contact_customer', 'resolved', null)),
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index pick_exceptions_line_idx on pick_exceptions (pick_line_id);
-- No separate pick_batch_id index: pick_exceptions has no such column (only
-- pick_line_id), and CREATE INDEX can't take a cross-table subquery as an
-- expression -- "batch's exceptions" queries join through pick_lines using
-- pick_exceptions_line_idx above and pick_lines_batch_idx (migration
-- 20260724090000_pick_batches_schema.sql).
create index pick_exceptions_unresolved_idx on pick_exceptions (organisation_id, resolved_at)
  where resolved_at is null;
create index pick_exceptions_created_idx on pick_exceptions (created_at desc);

-- RLS: scoped by node membership via organisation
alter table pick_exceptions enable row level security;

create policy pick_exceptions_select on pick_exceptions
  for select to authenticated
  using (
    organisation_id in (
      select organisation_id from staff_memberships
      where user_id = auth.uid()
    )
  );

create policy pick_exceptions_insert on pick_exceptions
  for insert to authenticated
  with check (
    organisation_id in (
      select organisation_id from staff_memberships
      where user_id = auth.uid()
    )
  );

create policy pick_exceptions_update on pick_exceptions
  for update to authenticated
  using (
    organisation_id in (
      select organisation_id from staff_memberships
      where user_id = auth.uid()
    )
  );

-- Helper: record exception during picking
create or replace function record_pick_exception(
  p_pick_line_id uuid,
  p_exception_type_code text,
  p_notes text default null,
  p_severity text default 'warning'
)
returns pick_exceptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exception pick_exceptions;
  v_pick_line pick_lines;
  v_batch pick_batches;
  v_exception_type_id uuid;
  v_org_id uuid;
begin
  select * into v_pick_line from pick_lines where id = p_pick_line_id;
  if v_pick_line is null then
    raise exception 'record_pick_exception: unknown pick line %', p_pick_line_id;
  end if;

  select * into v_batch from pick_batches where id = v_pick_line.pick_batch_id;
  if v_batch is null then
    raise exception 'record_pick_exception: batch not found for line %', p_pick_line_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'record_pick_exception: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  select id into v_exception_type_id from pick_exception_types where code = p_exception_type_code;
  if v_exception_type_id is null then
    raise exception 'record_pick_exception: unknown exception type %', p_exception_type_code;
  end if;

  select organisation_id into v_org_id from fulfilment_nodes where id = v_batch.fulfilment_node_id;

  insert into pick_exceptions (
    organisation_id, pick_line_id, exception_type_id, severity, notes, created_by_user_id
  ) values (
    v_org_id, p_pick_line_id, v_exception_type_id, p_severity, p_notes, auth.uid()
  )
  returning * into v_exception;

  return v_exception;
end;
$$;

revoke execute on function record_pick_exception(uuid, text, text, text) from public, anon;
grant execute on function record_pick_exception(uuid, text, text, text) to authenticated;

-- Helper: resolve exception with decision
create or replace function resolve_pick_exception(
  p_exception_id uuid,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exception pick_exceptions;
  v_pick_line pick_lines;
  v_batch pick_batches;
begin
  select * into v_exception from pick_exceptions where id = p_exception_id;
  if v_exception is null then
    raise exception 'resolve_pick_exception: unknown exception %', p_exception_id;
  end if;

  if v_exception.resolved_at is not null then
    raise exception 'resolve_pick_exception: exception % already resolved', p_exception_id;
  end if;

  select * into v_pick_line from pick_lines where id = v_exception.pick_line_id;
  select * into v_batch from pick_batches where id = v_pick_line.pick_batch_id;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'resolve_pick_exception: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  update pick_exceptions
  set resolution = p_resolution, resolved_at = now(), resolved_by_user_id = auth.uid(), updated_at = now()
  where id = p_exception_id;
end;
$$;

revoke execute on function resolve_pick_exception(uuid, text) from public, anon;
grant execute on function resolve_pick_exception(uuid, text) to authenticated;
