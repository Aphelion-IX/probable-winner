-- Which physical treatments a printing exists in (nonfoil/foil/etched, per
-- MTGJSON's own "finishes" field) — needed for the storefront's treatment
-- filter. Distinct from sellable_skus.finish (backlog Step 6): this column
-- says which finishes the printing was ever produced in, not which finish a
-- specific for-sale unit is.
alter table card_printings
  add column finishes text[] not null default '{}',
  add constraint card_printings_finishes_check
    check (finishes <@ array['nonfoil', 'foil', 'etched']::text[]);
