# Performance Budget and Seeded Test Data

This document specifies performance targets and the seeded dataset volumes all performance tests must run against.

## Performance Budgets (blueprint §2.3)

All performance tests must meet these targets at the seeded data scale (§23 below).

### Customer-Facing Storefront

| Scenario | Metric | Budget | Notes |
|----------|--------|--------|-------|
| Catalogue search (1000 results) | First Contentful Paint (FCP) | < 1.5 s | Mobile 4G, Chromium |
| Catalogue search (1000 results) | Largest Contentful Paint (LCP) | < 2.5 s | Mobile 4G, Chromium |
| Catalogue search (1000 results) | Cumulative Layout Shift (CLS) | < 0.1 | No jank from lazy-loaded images |
| Catalogue search (1000 results) | Interaction to Next Paint (INP) | < 200 ms | Filter clicks, sorting |
| Product detail page | FCP | < 1.2 s | Images pre-loaded from CDN |
| Product detail page | LCP | < 2.0 s | Card image renders |
| Cart update (add/remove line) | Interaction latency | < 100 ms | Optimistic update, no flickering |
| Checkout page load | FCP | < 1.5 s | Authenticated user, RLS applied |
| Order history page (100 rows) | Load time | < 2.0 s | Cursor pagination, virtualised list |
| Mobile bundle size | JavaScript (main app) | < 150 KB | Gzip, code-split per route |

### Staff Portal

| Scenario | Metric | Budget | Notes |
|----------|--------|--------|-------|
| Order search (staff view) | Search latency | < 1.5 s | 100k historical orders, filters |
| Inventory adjustment page | Load time | < 1.0 s | RLS scoped to store, balances table |
| Pricing review queue | Load + render | < 2.0 s | 500 queued prices per store |
| Pricing override form | Submit latency | < 500 ms | Function call + event emission |
| Transfer dispatch form | Load + render | < 1.5 s | List 10k+ historical transfers |
| Staff table virtualisation (1000 rows) | Scroll smoothness | 60 fps | No lag when scrolling |

### Backend Worker

| Scenario | Metric | Budget | Notes |
|----------|--------|--------|-------|
| Catalogue import | 10k printings | < 30 min | Full MTGJSON + image refs |
| Pricing calculation | 1M SKUs | < 60 min | Batched, cloud functions |
| Price publish batch | 50k prices | < 15 min | Parallel writes with conflict handling |
| Stocktake reconciliation | 10k movement records | < 5 min | Ledger scan + balance update |
| Reservation expiry batch | 50k active reservations | < 2 min | Cron job, 1min interval |
| Search reindex | 500k products | < 10 min | Typesense bulk API, delta sync |

### Database Query Performance

| Scenario | Metric | Budget | Notes |
|----------|--------|--------|-------|
| Inventory balance by SKU+store | Query latency | < 50 ms | Index on (fulfilment_node_id, sellable_sku_id) |
| Price lookup (SKU+org+currency) | Query latency | < 30 ms | Unique index on published_prices |
| Reservation list by order | Query latency | < 20 ms | Foreign key index on orders.id |
| RLS policy evaluation | Overhead | < 5 ms | Per query, relative to superuser bypass |
| Full-text search (Typesense) | Search latency | < 300 ms | 500k products, 10 filters |

## Seeded Dataset Volumes (blueprint §23)

All performance tests must run against this minimum data scale. Local dev and CI runs use proportionally smaller datasets (10% scale) for speed; staging and load-test environments use full scale.

### Catalogue

| Entity | Count | Notes |
|--------|-------|-------|
| Oracle cards (unique rules text) | 50,000+ | Core Magic card universe |
| Card printings (set editions) | 100,000+ | Multiple per card across sets |
| Card images (art variants) | 150,000+ | High-res art for all printings |
| Sets | 500+ | All Magic sets since Alpha |
| Languages | 15+ | English, Japanese, German, French, etc. |
| Card conditions | 6 | NM, LP, MP, HP, DMG + missing |
| Finishes | 3 | Normal, Foil, Etched |

### Inventory

| Entity | Count | Notes |
|--------|-------|-------|
| Sellable SKUs (product IDs) | 500,000+ | Cartesian of (printing, language, finish, condition) |
| Inventory balances | 1,000,000+ | Per-store inventory snapshot |
| Inventory movements | 5,000,000+ | Immutable ledger (receive, adjust, pick, etc.) |
| Stores | 4 | Geelong, Bendigo, Werribee, Ballarat |
| Storage locations | 40+ | Per-store bin structure |
| Transfers (historical) | 10,000+ | Inter-store movements |

### Pricing

| Entity | Count | Notes |
|--------|-------|-------|
| Pricing rules | 50+ | Different provider/currency/margin combos |
| Price snapshots (daily) | 5,000,000+ | 6+ providers × 100k printings × 60+ days |
| Calculated prices (per evaluation) | 1,000,000+ | Test runs with different modifier sets |
| Published prices (active) | 500,000+ | One per SKU in active price book |
| Price overrides (by store) | 10,000+ | Sparse, event promotions/exceptions |
| Exchange rates (historical) | 5,000+ | 2-3 currency pairs × hourly × 60+ days |

### Orders and Reservations

| Entity | Count | Notes |
|--------|-------|-------|
| Historical orders | 100,000+ | 6+ months of sales |
| Order lines | 500,000+ | Average 5 lines per order |
| Customers | 100,000+ | Authenticated users |
| Guest carts (active) | 50,000+ | Concurrent sessions |
| Reservations (active) | 50,000+ | Expiring within next hour |
| Carts (abandoned) | 100,000+ | Inactive > 7 days |

### Search Index

| Index | Document Count | Notes |
|-------|-----------------|-------|
| `products` (Typesense) | 500,000+ | One doc per SKU (card + variant) |
| Fields indexed | 20+ | Name, oracle text, tags, price, stock, condition |
| Facets | 10+ | Set, color, rarity, finish, condition, price range, store |

## Load Test Scenarios (blueprint §23)

The following scenarios must be tested under load at seeded-data scale. See B-211 for the full load-test suite.

1. **Concurrent searches**: 100 concurrent users searching catalogue (different queries)
2. **Hot card under contention**: 1000 concurrent users reserving last unit of a popular card
3. **100-card decklist import**: Resolve a 100-line decklist to SKUs and add to cart
4. **Store-level staff search**: Inventory manager searching 1M balances at one store
5. **Bulk repricing**: Publish 100k prices across all stores simultaneously
6. **Catalogue import during live shopping**: Full 10k printing import while storefront runs
7. **Transfer receiving**: 1000 concurrent transfer receipt line entries
8. **Reservation expiry batch**: 50k reservations expiring within 1 minute
9. **1000-line picking**: Warehouse worker picking 1000 order lines from multiple locations
10. **Repricing 100k products**: Recalculate and publish pricing for 100k SKUs

## Monitoring and Regression Detection

Performance is monitored continuously in staging and production:

- **Query performance**: Slow query log (> 100 ms) alerts via Sentry
- **Search latency**: Typesense metrics exported to monitoring dashboard
- **Page performance**: Lighthouse CI gate (LCP < 2.5s, CLS < 0.1) on every deploy
- **Worker job duration**: CloudTasks execution time tracked; alerts on > 2× baseline
- **RLS overhead**: Measured via `EXPLAIN ANALYZE` with RLS on vs. superuser bypass
- **Queue depth**: Supabase Queues (`pgmq`) backlog age monitored; alerts on > 5 min staleness

All performance regressions > 10% must be traced to a specific query plan or code change and fixed before merging (blueprint §21).
