-- pgTAP tests for store_addresses_select_public (backlog Step 13/B-121):
-- an anonymous customer can read an active store's address (needed to
-- render click-and-collect store selection at checkout), but not an
-- inactive store's address.
begin;

select plan(3);

select ok(
  (
    select qual like '%active%'
    from pg_policies
    where tablename = 'store_addresses' and policyname = 'store_addresses_select_public'
  ),
  'store_addresses has a public policy scoped to active stores'
);

create temp table test_ids_sap (key text primary key, id uuid);
grant select, insert on test_ids_sap to authenticated, anon;

insert into test_ids_sap (key, id) select 'org', id from organisations limit 1;

with active_node as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_click_collect)
  select (select id from test_ids_sap where key = 'org'), 'SAP Active Store', 'sapactive', 'store', true, true
  returning id
)
insert into test_ids_sap (key, id) select 'active_node', id from active_node;

with inactive_node as (
  insert into fulfilment_nodes (organisation_id, name, code, type, active, allows_click_collect)
  select (select id from test_ids_sap where key = 'org'), 'SAP Inactive Store', 'sapinactive', 'store', false, true
  returning id
)
insert into test_ids_sap (key, id) select 'inactive_node', id from inactive_node;

insert into store_addresses (fulfilment_node_id, line1, city, country)
values
  ((select id from test_ids_sap where key = 'active_node'), '1 Test St', 'Testville', 'Australia'),
  ((select id from test_ids_sap where key = 'inactive_node'), '2 Test St', 'Testville', 'Australia');

set local role anon;

select ok(
  (
    select count(*) = 1
    from store_addresses
    where fulfilment_node_id = (select id from test_ids_sap where key = 'active_node')
  ),
  'an anonymous customer can read an active store''s address'
);

select ok(
  (
    select count(*) = 0
    from store_addresses
    where fulfilment_node_id = (select id from test_ids_sap where key = 'inactive_node')
  ),
  'an anonymous customer cannot read an inactive store''s address'
);

reset role;

select finish();

rollback;
