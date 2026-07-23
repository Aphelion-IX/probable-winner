-- Sellable-product reference data and SKUs are public storefront data, same
-- reasoning as catalogue_rls.sql: customers browse without logging in, and
-- writes only ever come from the worker's SKU-generation job via the
-- service-role key (bypasses RLS) — no write policies here.

alter table conditions enable row level security;
alter table languages enable row level security;
alter table finishes enable row level security;
alter table product_statuses enable row level security;
alter table sellable_skus enable row level security;

create policy conditions_select on conditions for select to anon, authenticated using (true);
create policy languages_select on languages for select to anon, authenticated using (true);
create policy finishes_select on finishes for select to anon, authenticated using (true);
create policy product_statuses_select on product_statuses for select to anon, authenticated using (true);
create policy sellable_skus_select on sellable_skus for select to anon, authenticated using (true);
