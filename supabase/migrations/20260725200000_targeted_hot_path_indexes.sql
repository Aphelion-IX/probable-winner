-- Indexes for the four query shapes measured as actually slow on the live
-- database (5.2M inventory_movements, 1.2M inventory_balances, 816k
-- sellable_skus). Every one below was verified with EXPLAIN (ANALYZE) against
-- real data before being written here; the before/after numbers are quoted
-- per index.
--
-- Deliberately NOT a blanket indexing pass. The performance advisor already
-- reports ~125 never-scanned indexes on this schema (see docs/performance.md
-- -- they are untraversed query paths, not waste, so they stay). Adding more
-- speculative indexes would grow that pile and tax every write. Tables that
-- are currently empty -- profiles, packing_shipments, quarantined_inventory
-- -- were checked and deliberately skipped: indexing them now would be
-- guessing at a shape no query has ever run.
--
-- CONCURRENTLY is not used because a migration runs inside a transaction and
-- CREATE INDEX CONCURRENTLY cannot. On a live database with traffic, build
-- these by hand with CONCURRENTLY instead of taking the write lock this
-- migration implies -- inventory_movements is 1.4 GB and the build is not
-- instant.

-- 1. Card-name search: `ilike '%term%'` cannot use a btree at all, so this
--    was a sequential scan of oracle_cards on every keystroke-driven search.
--    Feeds the staff inventory search, the receiving/transfer SKU pickers,
--    and the joined sellable_skus lookup behind them.
--
--    Measured: 26.7 ms -> 0.148 ms (~180x). Index size: 2.5 MB.
--
--    pg_trgm is the standard answer for unanchored ILIKE; it was available on
--    this project but never installed.
create extension if not exists pg_trgm;

create index if not exists oracle_cards_name_trgm_idx
  on oracle_cards using gin (name gin_trgm_ops);

-- 2. Staff "recent receipts" (listRecentReceipts): newest goods-in movements
--    across the viewer's nodes, over a 5.2M-row ledger.
--
--    Measured: 5,654 ms -> 0.088 ms. Index size: 47 MB.
--
--    Note the shape. The obvious index --
--    (fulfilment_node_id, movement_type, created_at desc) -- was tried first
--    and the planner *rejected* it: 1.2M of 5.2M rows are 'receive', so it
--    preferred a parallel seq scan + top-N sort. Leading on created_at with
--    movement_type as a partial predicate is what lets it walk the index
--    newest-first and stop after LIMIT rows; fulfilment_node_id rides along
--    via INCLUDE so the node filter is checked without a heap visit.
create index if not exists inventory_movements_receive_recent_idx
  on inventory_movements (created_at desc)
  include (fulfilment_node_id)
  where movement_type = 'receive';

-- 3. Staff inventory search (searchInventory): in-stock rows across the
--    viewer's nodes, largest holdings first.
--
--    Measured: 1,685 ms -> 32.8 ms (~51x). Index size: 62 MB.
--
--    Same walk-the-order-by shape as above. This is the most expensive index
--    in this migration on the write side: quantity_on_hand is its leading
--    key and changes on every receive/sale/reserve/transfer, so each such
--    write moves the index entry rather than doing a HOT update. It is
--    included because the staff inventory screen has a < 1.0 s budget
--    (docs/performance.md) and currently takes 1.7 s. If write throughput on
--    inventory_balances ever becomes the binding constraint, the cheaper fix
--    is to drop the quantity_on_hand sort from that screen and rely on the
--    existing (fulfilment_node_id, sellable_sku_id) unique index -- then
--    this index can go.
create index if not exists inventory_balances_in_stock_idx
  on inventory_balances (quantity_on_hand desc)
  include (fulfilment_node_id, sellable_sku_id)
  where quantity_on_hand > 0;

-- 4. Staff transfers list: newest first. Small today (12k rows, 23.6 ms seq
--    scan) but monotonically growing and trivially cheap to maintain --
--    created_at is insert-only, so entries are appended, never moved.
--    Index size: 280 kB.
create index if not exists transfer_orders_created_at_idx
  on transfer_orders (created_at desc);
