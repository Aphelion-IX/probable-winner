-- RECONCILIATION NOTE: pulled verbatim from the live project's migration
-- history (see 20260723064823_fix_transfer_status_transitions.sql for why).

-- MTGJSON's World Championship deck sets (WC97-WC04) and Pro Tour
-- Collector's Edition (PTC) use a "signed" finish that the original
-- CHECK constraint didn't allow, causing these 9 sets to fail import
-- and retry forever.

alter table card_printings drop constraint card_printings_finishes_check;
alter table card_printings add constraint card_printings_finishes_check
  check (finishes <@ array['nonfoil', 'foil', 'etched', 'signed']);
