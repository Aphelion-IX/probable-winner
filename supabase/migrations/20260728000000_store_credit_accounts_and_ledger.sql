-- Store credit accounts and ledger (blueprint §8.9, deferred by
-- 20260724180000_customer_profiles_and_addresses.sql: "store_credit_accounts
-- (§8.9) for balances, which this task does not touch").
--
-- Same architecture as inventory_balances/inventory_movements (hard rule 12,
-- and blueprint §8.9's own "never store an editable account-credit balance
-- without a transaction ledger"): store_credit_accounts is a fast-read
-- current-balance table, store_credit_ledger is the immutable ledger it's
-- derived from, and adjust_store_credit() below is the only writer of
-- either table. No insert/update/delete RLS policy exists for either table
-- on purpose -- until adjust_store_credit() (a SECURITY DEFINER function),
-- there is no supported write path at all, matching hard rule 2.
--
-- Trade-in intake itself (turning physical cards into inventory) stays a
-- manual staff process via the existing adjust_inventory()
-- 'buylist_acquisition' movement type -- this migration only builds the
-- money side: crediting (or removing credit from) a customer's account,
-- decoupled from any specific trade-in UI.

create table store_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  currency text not null default 'AUD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_credit_accounts_customer_currency_uq unique (customer_id, currency)
);

create index store_credit_accounts_org_idx on store_credit_accounts (organisation_id);

create table store_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  store_credit_account_id uuid not null references store_credit_accounts(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'trade_in', 'goodwill', 'refund', 'correction', 'redemption'
  )),
  -- Signed change applied to store_credit_accounts.balance -- not
  -- constrained non-negative, since removing credit (redemption/correction)
  -- is a negative delta by definition (mirrors inventory_movements'
  -- quantity_delta).
  amount_delta numeric(12, 2) not null check (amount_delta <> 0),
  reference_type text,
  reference_id uuid,
  staff_user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index store_credit_ledger_account_idx on store_credit_ledger (store_credit_account_id);
create index store_credit_ledger_org_idx on store_credit_ledger (organisation_id);
create index store_credit_ledger_reference_idx on store_credit_ledger (reference_type, reference_id);

alter table store_credit_accounts enable row level security;
alter table store_credit_ledger enable row level security;

-- Customers read their own account/ledger; staff with customers.credit read
-- across the organisation (needed to look a customer's balance up before
-- adjusting it).
create policy store_credit_accounts_select on store_credit_accounts
  for select to authenticated
  using (customer_id = auth.uid() or staff_has_permission('customers.credit'));

create policy store_credit_ledger_select on store_credit_ledger
  for select to authenticated
  using (
    exists (
      select 1 from store_credit_accounts a
      where a.id = store_credit_ledger.store_credit_account_id and a.customer_id = auth.uid()
    )
    or staff_has_permission('customers.credit')
  );

-- Table-level grants: RLS policies only decide which rows a role may touch
-- once Postgres has already granted the role access to the table at all
-- (see 20260727010000's header for why this repo learned that lesson the
-- hard way). Select only -- writes go exclusively through
-- adjust_store_credit(), matching audit_events' and the inventory tables'
-- own grant comments.
grant select on store_credit_accounts to authenticated;
grant select on store_credit_ledger to authenticated;

-- New permission, granted to the roles whose job includes handling customer
-- credit (trade-ins, goodwill, refund-to-credit). owner/system_admin and
-- regional_manager already pick this up automatically from
-- 20260725160000's blanket/near-blanket grants.
insert into permissions (code, description) values
  ('customers.credit', 'Apply or remove customer store credit')
on conflict do nothing;

insert into role_permissions (role_code, permission_code) values
  ('store_manager', 'customers.credit'),
  ('customer_service', 'customers.credit')
on conflict do nothing;

-- Shared row-lock step, same pattern as lock_inventory_balance(): ensures an
-- account exists for (customer, currency), then locks it so concurrent
-- adjustments serialize instead of losing an update. Not exposed to
-- authenticated/anon -- callers must go through adjust_store_credit().
create or replace function lock_store_credit_account(
  p_organisation_id uuid,
  p_customer_id uuid,
  p_currency text
) returns store_credit_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account store_credit_accounts;
begin
  insert into store_credit_accounts (organisation_id, customer_id, currency)
  values (p_organisation_id, p_customer_id, p_currency)
  on conflict (customer_id, currency) do nothing;

  select * into v_account
  from store_credit_accounts
  where customer_id = p_customer_id and currency = p_currency
  for update;

  return v_account;
end;
$$;

revoke execute on function lock_store_credit_account(uuid, uuid, text) from public, anon, authenticated;

create or replace function adjust_store_credit(
  p_customer_id uuid,
  p_amount_delta numeric,
  p_entry_type text,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_currency text default 'AUD'
) returns store_credit_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organisation_id uuid;
  v_account store_credit_accounts;
  v_entry store_credit_ledger;
begin
  if p_amount_delta = 0 then
    raise exception 'adjust_store_credit: amount_delta must be non-zero';
  end if;

  if p_entry_type not in ('trade_in', 'goodwill', 'refund', 'correction', 'redemption') then
    raise exception 'adjust_store_credit: % is not a recognised entry_type', p_entry_type;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'adjust_store_credit: a reason is required';
  end if;

  if not staff_has_permission('customers.credit') then
    raise exception 'adjust_store_credit: access denied' using errcode = '42501';
  end if;

  -- Re-derived server-side from the caller's own active membership rather
  -- than trusting a client-supplied organisation id -- same reasoning as
  -- receive_inventory() resolving organisation_id from the fulfilment node
  -- instead of taking it as a parameter.
  select organisation_id into v_organisation_id
  from staff_memberships
  where user_id = auth.uid() and active
  limit 1;

  if v_organisation_id is null then
    raise exception 'adjust_store_credit: caller has no active staff membership';
  end if;

  v_account := lock_store_credit_account(v_organisation_id, p_customer_id, p_currency);

  begin
    update store_credit_accounts
    set balance = balance + p_amount_delta, updated_at = now()
    where id = v_account.id;
  exception when check_violation then
    raise exception 'adjust_store_credit: insufficient store credit balance for customer % (has %, requested %)',
      p_customer_id, v_account.balance, p_amount_delta
      using errcode = '23514';
  end;

  insert into store_credit_ledger (
    organisation_id, store_credit_account_id, entry_type, amount_delta,
    reference_type, reference_id, staff_user_id, reason
  ) values (
    v_organisation_id, v_account.id, p_entry_type, p_amount_delta,
    p_reference_type, p_reference_id, auth.uid(), p_reason
  )
  returning * into v_entry;

  perform record_audit_event(
    v_organisation_id, 'customers.adjust_credit', 'store_credit_ledger', v_entry.id,
    jsonb_build_object(
      'customerId', p_customer_id, 'entryType', p_entry_type,
      'amountDelta', p_amount_delta, 'reason', p_reason
    )
  );

  return v_entry;
end;
$$;

revoke execute on function adjust_store_credit(uuid, numeric, text, text, text, uuid, text) from public, anon;
grant execute on function adjust_store_credit(uuid, numeric, text, text, text, uuid, text) to authenticated;
