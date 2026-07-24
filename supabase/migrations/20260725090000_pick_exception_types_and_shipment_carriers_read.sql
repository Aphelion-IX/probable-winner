-- Of the 7 tables get_advisors flagged as "RLS enabled, no policies exist":
-- catalogue_staging_cards/sets, integration_events, price_import_exceptions,
-- and price_staging_rows are internal-only (populated and consumed by the
-- catalogue/pricing-import worker via its service-role connection, which
-- bypasses RLS) -- deny-all for anon/authenticated is correct there, left
-- as-is.
--
-- pick_exception_types and shipment_carriers are different: they're static
-- reference/lookup tables (same shape as conditions/finishes/languages,
-- which already have a public read policy -- 20260723052115_sellable_skus_rls.sql),
-- read directly by the staff portal via the anon-key client
-- (apps/web/src/features/staff/actions/manage-shipment.ts's
-- getAvailableCarriers(), handle-pick-exception.ts's pick_exception_types
-- embed). With no policy, those reads have been silently returning empty
-- under RLS -- the carrier dropdown on the packing/shipping screen and the
-- exception-type label on pick exceptions have never actually worked. Fix
-- per AGENTS.md rule 4: add the missing policy rather than bypass RLS.
create policy pick_exception_types_select on pick_exception_types
  for select to anon, authenticated using (true);

create policy shipment_carriers_select on shipment_carriers
  for select to anon, authenticated using (true);
