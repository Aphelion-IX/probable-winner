-- RLS for the pricing engine schema (backlog B-160). Staff-only select,
-- same convention as the pricing import tables (20260723073038) -- pricing
-- is not customer-facing until it's published through a price book in a
-- later step. No write policies: B-161's calculation function and
-- B-163's approval/override function (both SECURITY DEFINER, not yet
-- built) are the only intended writers, matching how the transfer schema
-- (20260723064323) landed with staff-select-only RLS a migration before
-- its dispatch/receive functions arrived.

alter table pricing_rules enable row level security;
alter table pricing_condition_modifiers enable row level security;
alter table pricing_stock_modifiers enable row level security;
alter table calculated_prices enable row level security;
alter table calculated_price_inputs enable row level security;

create policy pricing_rules_select on pricing_rules for select to authenticated using (true);
create policy pricing_condition_modifiers_select on pricing_condition_modifiers for select to authenticated using (true);
create policy pricing_stock_modifiers_select on pricing_stock_modifiers for select to authenticated using (true);
create policy calculated_prices_select on calculated_prices for select to authenticated using (true);
create policy calculated_price_inputs_select on calculated_price_inputs for select to authenticated using (true);
