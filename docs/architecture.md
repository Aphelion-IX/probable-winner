# Multi-Store Trading Card Retail Platform — Development Stack and Build Blueprint

This document is the source architecture and build blueprint for the platform. It is
referenced by section number (e.g. "blueprint §9.3") throughout `docs/backlog.md` and
other docs in this repository. Treat it as authoritative for architecture decisions;
propose changes via PR rather than editing ad hoc.

## 1. Application introduction

The application is a fast, retail-first trading-card commerce and inventory platform
designed for retailers operating one or many physical stores.

Its primary purpose is to provide customers with a faster and more capable
alternative to MTG MATE while giving the retailer one central system for:

- card catalogue management;
- online retail sales;
- store-level inventory;
- warehouse inventory;
- click and collect;
- stock transfers;
- pricing intelligence;
- deck-list purchasing;
- order fulfilment;
- customer accounts;
- restock notifications;
- future buylist functionality.

The platform must support a retailer operating:

- 1 online store
- 4 physical stores, no separate central warehouse — every store supports
  click-and-collect, online fulfilment, and store-to-store transfers; there
  is no single designated hub
- Thousands of daily customers
- Hundreds of thousands of card printings
- Millions of inventory records

Customers should experience: one catalogue, one fast search, one cart, one
checkout, clear store availability, reliable delivery or collection.

Retail staff should experience: central catalogue management, central pricing,
separate stock by store, controlled store transfers, fast receiving and grading,
location-based picking, store-level permissions, complete inventory history.

The marketplace is a future expansion. It must not complicate or delay the retail
platform.

## 2. Core product principles

### 2.1 Retail first

Retail-owned stock receives priority in: search; card pages; deck-list matching;
pricing; fulfilment; administration; development sequencing.

The first production release should not include: user listings; seller accounts;
marketplace payments; seller shipping; auctions; seller ratings; seller messaging.

### 2.2 Multi-store from the beginning

Every physical store and warehouse is represented as a fulfilment node.

A fulfilment node can: hold inventory; receive cards; reserve cards; pick orders;
fulfil click-and-collect orders; ship online orders; transfer stock; perform
stocktakes; quarantine damaged or uncertain cards.

### 2.3 Speed is a release requirement

Features are not complete merely because they work. They must also meet
performance requirements.

Internal performance targets:

| Operation | Target |
|---|---|
| Search suggestions | Under 150 ms |
| Search results | Under 250 ms |
| Store availability change | Under 300 ms |
| Add-to-cart confirmation | Under 300 ms |
| Cached product page response | Under 500 ms |
| Staff inventory search | Under 250 ms |
| Standard interaction response | Under 100 ms |
| Mobile Largest Contentful Paint | Under 2 seconds |
| Mobile Interaction to Next Paint | Under 200 ms |

These targets must be tested against realistic data, not an empty development
database.

### 2.4 PostgreSQL is the transaction authority

Search indexes, caches and page data may improve performance, but PostgreSQL
remains authoritative for: inventory; reservations; orders; payments; transfers;
prices; staff permissions; customer balances.

### 2.5 Heavy work must not block customer requests

The following work must run in background jobs: catalogue imports; pricing
imports; bulk repricing; search indexing; restock notifications; order emails;
abandoned reservation cleanup; report generation; stock reconciliation.

The web request should enqueue the work and return quickly.

## 3. Recommended development stack

### 3.1 Application stack

| Area | Technology |
|---|---|
| Main framework | Next.js App Router |
| Programming language | TypeScript |
| UI framework | React |
| Styling | Tailwind CSS |
| Component library | shadcn/ui |
| Icons | Lucide |
| Forms | React Hook Form |
| Validation | Zod |
| Package manager | pnpm |
| Formatting | Prettier |
| Linting | ESLint |
| Unit tests | Vitest |
| Browser tests | Playwright |
| Database tests | pgTAP |
| Source control | GitHub |
| CI | GitHub Actions |

Next.js App Router supports Server Components, Server Functions, route handlers,
layouts, Suspense and optimised client navigation in one application. That makes
it suitable for a solo developer who needs public retail pages, staff
administration and backend-for-frontend routes without maintaining a separate API
application.

### 3.2 Backend services

| Requirement | Technology |
|---|---|
| Primary database | Supabase PostgreSQL |
| Authentication | Supabase Auth |
| Authorisation | PostgreSQL RLS and server permissions |
| File storage | Supabase Storage |
| Background queue | Supabase Queues |
| Scheduled jobs | Supabase Cron |
| Search | Typesense |
| Payments | Stripe Checkout |
| Email | Resend and React Email |
| Application hosting | Vercel |
| Background worker hosting | Railway, Render or equivalent container host |
| Error monitoring | Sentry |
| Product analytics | Vercel Analytics or PostHog |
| Performance monitoring | Vercel Speed Insights and Sentry |

Supabase supports local development through its CLI, with database migrations
committed to source control and deployed through controlled environments.

Supabase Queues provides a Postgres-backed durable queue suitable for persisting
background tasks. Supabase Cron can schedule recurring jobs within PostgreSQL.

### 3.3 External data providers

| Data | Initial provider |
|---|---|
| Card catalogue | MTGJSON |
| Card identity mapping | MTGJSON and Scryfall identifiers |
| Card images | Approved external card-image provider |
| TCGplayer pricing | MTGJSON initially |
| Card Kingdom pricing | MTGJSON initially |
| Direct TCGplayer updates | TCGplayer API when access is available |
| Exchange rates | Dedicated foreign-exchange provider |
| Shipping | Australia Post or selected shipping provider |
| Address verification | Australia Post or Google address service |

External integrations must use provider adapters. Business logic must never
depend directly on a provider's response structure.

## 4. Runtime architecture

The system should use a modular monolith with one separate background worker.

```
Customer or staff browser
            |
            v
      Next.js web app
      +-- Storefront
      +-- Customer account
      +-- Staff portal
      +-- Server Actions
      +-- Route handlers
      +-- Webhooks
            |
            v
    Supabase PostgreSQL
      +-- Catalogue
      +-- Inventory
      +-- Reservations
      +-- Pricing
      +-- Orders
      +-- Stores
      +-- Permissions
      +-- Audit history
      +-- Job queues
            |
            v
      Background worker
      +-- Catalogue import
      +-- Pricing import
      +-- Search indexing
      +-- Emails
      +-- Restock alerts
      +-- Reconciliation

Customer search
      |
      v
    Typesense
```

This is not a microservice architecture. There are only two runtime applications:

1. The Next.js web application.
2. The background worker.

Both use the same: database; domain models; validation schemas; generated
database types; business rules.

## 5. Repository structure

Use a lightweight pnpm workspace:

```
card-retail-platform/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── server/
│   │   │   ├── styles/
│   │   │   └── middleware/
│   │   ├── public/
│   │   ├── next.config.ts
│   │   └── package.json
│   └── worker/
│       ├── src/
│       │   ├── consumers/
│       │   ├── jobs/
│       │   ├── integrations/
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── domain/
│   │   ├── catalogue/
│   │   ├── inventory/
│   │   ├── pricing/
│   │   ├── checkout/
│   │   ├── fulfilment/
│   │   └── stores/
│   ├── database/
│   │   ├── generated/
│   │   ├── queries/
│   │   ├── commands/
│   │   └── clients/
│   ├── search/
│   │   ├── schemas/
│   │   ├── indexing/
│   │   └── client/
│   ├── integrations/
│   │   ├── mtgjson/
│   │   ├── tcgplayer/
│   │   ├── cardkingdom/
│   │   ├── stripe/
│   │   ├── email/
│   │   └── shipping/
│   ├── ui/
│   └── config/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   ├── functions/
│   ├── tests/
│   └── config.toml
├── tests/
│   ├── e2e/
│   ├── performance/
│   └── fixtures/
├── docs/
│   ├── product-purpose.md
│   ├── architecture.md
│   ├── database.md
│   ├── inventory-rules.md
│   ├── pricing-rules.md
│   ├── security.md
│   ├── performance.md
│   ├── testing.md
│   └── deployment.md
├── .github/
│   └── workflows/
├── AGENTS.md
├── CLAUDE.md
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## 6. Next.js application structure

```
apps/web/src/app/
├── (storefront)/
│   ├── page.tsx
│   ├── search/
│   ├── cards/
│   ├── sets/
│   ├── deck-builder/
│   ├── recently-added/
│   ├── cart/
│   └── checkout/
├── (account)/
│   ├── account/
│   ├── orders/
│   ├── saved-lists/
│   ├── restock-alerts/
│   ├── price-alerts/
│   └── store-credit/
├── staff/
│   ├── dashboard/
│   ├── orders/
│   ├── inventory/
│   ├── receiving/
│   ├── transfers/
│   ├── pricing/
│   ├── picking/
│   ├── shipping/
│   ├── stores/
│   ├── customers/
│   └── settings/
├── api/
│   ├── search/
│   ├── stripe/webhook/
│   ├── shipping/webhook/
│   ├── health/
│   └── internal/jobs/
├── layout.tsx
├── error.tsx
├── loading.tsx
└── not-found.tsx
```

Use Server Components by default.

Use Client Components only for: search interaction; filters; cart controls;
forms; scanners; tables requiring selection; dialogs; optimistic updates.

Do not place complete pages behind `"use client"`.

## 7. Feature-module structure

Each feature should own its: types; validation; queries; commands; components;
tests; business rules.

```
features/inventory/
├── components/
├── queries/
├── actions/
├── schemas/
├── services/
├── tests/
└── index.ts
```

A React component must not contain business-critical inventory calculations.

Incorrect: `InventoryButton.tsx` manually subtracts stock.

Correct: `InventoryButton.tsx` calls `reserveInventory()`, which invokes an atomic
database operation.

## 8. Core database domains

### 8.1 Organisation and stores

`organisations`, `fulfilment_nodes`, `store_addresses`, `store_hours`,
`store_settings`, `storage_locations`, `staff_memberships`, `roles`,
`permissions`, `role_permissions`.

`fulfilment_nodes.type`: `store`, `warehouse`, `distribution_centre`,
`event_location`.

Important fields on `fulfilment_nodes`: `id`, `organisation_id`, `name`, `code`,
`type`, `timezone`, `active`, `allows_click_collect`, `allows_online_fulfilment`,
`allows_transfers`, `dispatch_cutoff`, `safety_stock_policy_id`.

### 8.2 Catalogue

`games`, `sets`, `oracle_cards`, `card_printings`, `card_identifiers`,
`card_images`, `formats`, `card_legalities`, `artists`, `catalogue_import_runs`,
`catalogue_import_errors`.

The catalogue describes the card, not its stock.

### 8.3 Sellable products

`sellable_skus`, `conditions`, `languages`, `finishes`, `product_statuses`.

A sellable SKU represents: exact printing + language + finish + condition.

Example: Lightning Bolt, Magic 2011, Collector number 149, English, Foil, Near
Mint.

### 8.4 Inventory

`inventory_balances`, `inventory_movements`, `inventory_reservations`,
`inventory_allocations`, `inventory_batches`, `inventory_batch_lines`,
`inventory_adjustments`, `stocktakes`, `stocktake_lines`,
`quarantined_inventory`.

### 8.5 Transfers

`transfer_orders`, `transfer_order_lines`, `transfer_shipments`,
`transfer_receipts`.

### 8.6 Pricing

`price_sources`, `price_import_runs`, `price_import_errors`, `price_snapshots`,
`price_books`, `price_book_entries`, `store_price_book_assignments`,
`store_price_overrides`, `pricing_rules`, `calculated_prices`,
`price_approvals`, `price_overrides`,
`pricing_exceptions`, `exchange_rates`.

### 8.7 Shopping and orders

`carts`, `cart_lines`, `cart_adjustments`, `orders`, `order_lines`,
`order_status_history`, `order_allocations`, `order_fulfilments`, `payments`,
`refunds`, `shipments`, `shipment_lines`, `collection_orders`.

### 8.8 Customer accounts

`profiles`, `customer_addresses`, `saved_lists`, `saved_list_lines`,
`decklists`, `decklist_lines`, `restock_subscriptions`, `price_subscriptions`,
`recently_viewed`, `customer_preferences`.

### 8.9 Financial ledgers

`store_credit_accounts`, `store_credit_ledger`, `gift_cards`,
`gift_card_ledger`.

Never store an editable account-credit balance without a transaction ledger.

### 8.10 Operations and audit

`audit_events`, `integration_events`, `webhook_events`, `job_runs`,
`failed_jobs`, `system_health_checks`.

## 9. Inventory architecture

### 9.1 Inventory balances

Use a current balance table for fast reads:

```
inventory_balances
├── fulfilment_node_id
├── sellable_sku_id
├── quantity_on_hand
├── quantity_reserved
├── quantity_allocated
├── quantity_picking
├── quantity_quarantined
├── quantity_safety_stock
├── quantity_available_online
└── updated_at
```

Do not calculate live availability by summing the full movement ledger whenever
a customer opens a page.

`inventory_balances` also carries an optional `storage_location_id`
(nullable — not every store has location-tagged stock yet), recording
where a SKU's stock physically sits within a node. This is what pick-batch
generation sorts by to minimize walking distance (§11's picking workflow);
a SKU with no location assigned yet sorts last rather than blocking batch
creation.

### 9.2 Inventory movement ledger

Every stock change creates an immutable movement:

```
inventory_movements
├── id
├── organisation_id
├── fulfilment_node_id
├── sellable_sku_id
├── movement_type
├── quantity_delta
├── reference_type
├── reference_id
├── staff_user_id
├── reason
└── created_at
```

Movement types: `receive`, `sale`, `reserve`, `release_reservation`, `allocate`,
`begin_picking`, `complete_picking`, `transfer_out`, `transfer_in`, `damage`,
`quarantine`, `stocktake_adjustment`, `return`, `buylist_acquisition`.

### 9.3 Atomic stock operations

Create controlled database operations for: `receive_inventory()`,
`reserve_inventory()`, `release_inventory_reservation()`,
`allocate_order_inventory()`, `begin_inventory_pick()`,
`complete_inventory_pick()`, `adjust_inventory()`, `dispatch_transfer()`,
`receive_transfer()`.

Each operation should:

1. Lock the affected balance row.
2. Validate the requested quantity.
3. Write the movement.
4. Update the balance.
5. Write an integration event.
6. Commit the transaction.

The browser must not update inventory tables directly.

## 10. Cart and reservation architecture

Reservation process:

```
Customer adds card
        v
Database locks balance row
        v
Availability is validated
        v
Reservation is created
        v
Available quantity is reduced
        v
Cart response returns
```

Reservations need: `reservation_id`, `cart_id`, `sellable_sku_id`,
`fulfilment_node_id`, `quantity`, `expires_at`, `status`.

Reservation statuses: `active`, `converted`, `released`, `expired`, `cancelled`.

A scheduled job releases expired reservations.

Checkout validation must revalidate: reservation ownership; reservation expiry;
current price; shipping method; fulfilment location; customer address; cart
total.

### 10.1 Current implementation status

Add-to-cart, the cart page, and checkout are now real end-to-end rather than
each stopping at a different mocked layer:

- `SkuSelector` (the card identity page) has a working quantity/"Add to
  cart" control calling `addToCart()`
  (`apps/web/src/app/actions/add-to-cart.ts`), which resolves a store via
  `resolveDefaultStore()`, a cart via `get_or_create_cart()`, and reserves
  via the atomic `add_to_cart()` database function.
- `/cart` renders real line items via a new `get_cart_contents()` database
  function (guest carts have no raw-table RLS -- see
  `20260723070153_carts.sql`'s comment -- so this SECURITY DEFINER function
  is the only correct read path for one), with working quantity +/- and
  remove controls calling `update_cart_line_quantity()`/`remove_cart_line()`.
- `/checkout` fetches that same real cart server-side and threads its real
  `cartId`, line items, and subtotal into `OrderReview` -- no more hardcoded
  `"demo_cart"` id or mocked $299.85 subtotal. Click-and-collect's store
  list is real too (`listClickAndCollectStores()`, joined against
  `store_addresses`, which needed its own public-read RLS policy alongside
  `fulfilment_nodes`'s -- see `20260724240000_store_addresses_public_read.sql`).
- Still placeholder: shipping is a flat $15/free rate and tax is a flat
  10%, matching `create-pending-order.ts`'s existing scope -- there is no
  real shipping-cost calculation or tax-jurisdiction logic yet.
- The store selector, cart badge, and add-to-cart wiring above replaced a
  fully dead, never-rendered `RootNavbar`/`StoreSelector` pair (the real
  layout has always used `StorefrontShell` → `SiteHeader`, per
  `apps/web/src/app/(storefront)/layout.tsx`). `SiteHeader`'s own store
  selector and cart icon were previously decorative (no store list, no
  count); the header's search input didn't submit anywhere either. All
  three are now real, and deliberately fetch/read client-side
  (`/api/stores`, `/api/cart/count`) rather than as Server Component reads
  in the shared layout -- reading the cart cookie there would force every
  page under it into dynamic rendering with no PPR/Cache Components opted
  in (see the framework-version note in AGENTS.md), undoing the static
  caching on the card identity/sets/home pages.

## 11. Multi-store order routing

The order-routing service should select fulfilment locations using:

1. Customer's selected click-and-collect store.
2. Central warehouse priority.
3. A single store that can fulfil the whole order.
4. The minimum number of fulfilment nodes.
5. Dispatch cutoff.
6. Transfer time.
7. Shipping cost.
8. Store safety stock.
9. Split-shipment permission.

Example:

```
Warehouse can supply 18 of 20 cards
Melbourne can supply all 20 cards
Frankston can supply 12 cards
```

Preferred result: route all 20 cards to Melbourne.

Do not split the order between the warehouse and Melbourne unless the business
rule prefers warehouse stock strongly enough to justify the extra handling.

The routing decision should be stored in `order_allocations`: `order_line_id`,
`fulfilment_node_id`, `quantity`, `routing_reason`, `allocation_status`.

### 11.1 Current implementation status

The priority-scored algorithm above is implemented and tested
(`@probable-winner/routing`, including this section's Melbourne
18-of-20-vs-20-of-20 example and real dispatch-cutoff/transfer-time logic),
but it only makes a *live* choice among nodes when one genuinely exists.
`reserve_inventory()` already commits each cart line to a specific
fulfilment node at add-to-cart time (the customer's selected/preferred
store), so by checkout there is no remaining live choice for those units —
running the scoring algorithm again at that point would be theatre, not a
real decision. What checkout actually does (`createPendingOrder()`) is
classify the already-committed node using this section's same priority
vocabulary (`click_and_collect_store`, `warehouse_priority`,
`single_complete_order_store`, `split_minimum_nodes`) and persist that to
`order_allocations` for every line, so the audit trail is real even though
the decision point has effectively already happened at cart time.

`orders` carries a single `fulfilment_node_id` — it does not yet support a
genuinely split multi-node order. When a cart's lines are reserved across
more than one node, the node covering the largest quantity becomes the
order's primary node; every line's real allocation (including ones at a
different node) is still recorded in `order_allocations`, but `orders`/
`shipments` cannot yet represent "this order shipped from three different
stores." Full split-shipment support needs that schema extended — a larger,
deliberate change, not attempted as part of this pass.

`route_order()`'s full scoring (including the split-order fallback branch)
does have a genuine live-decision use case: choosing which node
`reserve_inventory()` reserves *from* when a customer adds an online-
shipping item to their cart, rather than committing to whatever node the
storefront happens to be browsing. That integration point is still not
wired up: `addToCart()` (`apps/web/src/app/actions/add-to-cart.ts`) is now
reachable from the storefront UI (the card identity page's SKU selector)
and resolves a real cart/store/reservation via `get_or_create_cart()` and
`add_to_cart()`, but its store choice is a placeholder — the first active
store with `allows_online_fulfilment`, not `route_order()`'s scoring — and
there's still no durable "customer's preferred store" mechanism (the
navbar's store selector is local UI state only, not persisted or wired
into any write path) to feed a real choice in.

## 12. Store transfer support

Transfer workflow: Draft → Requested → Accepted → Picking → Dispatched → In
transit → Partially received → Received.

When a transfer is dispatched: stock leaves available inventory at the source;
stock enters in-transit inventory; stock is not available at the destination;
destination stock becomes available only after receipt.

Transfers should support: store-to-store; warehouse-to-store; store-to-
warehouse; partial receipt; missing cards; damaged-in-transit cards; transfer
cancellation.

## 13. Search architecture

### 13.1 Typesense purpose

Typesense should handle: instant search; autocomplete; typo tolerance; faceted
filtering; sorting; popularity ranking; store-availability filtering; recently
added feeds.

Typesense supports typo-tolerant text queries, exact filters, configurable
relevance and field-weighting.

PostgreSQL remains authoritative. Typesense can be rebuilt at any time.

### 13.2 Search document

Use one compact document per exact printing, with aggregated stock and
condition information:

```ts
type CardSearchDocument = {
  printingId: string;
  oracleCardId: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  artist: string;
  colours: string[];
  colourIdentity: string[];
  types: string[];
  formats: string[];
  languages: string[];
  finishes: string[];
  conditions: string[];
  onlineAvailableQuantity: number;
  availableStoreIds: string[];
  pickupStoreIds: string[];
  lowestPrice: number | null;
  highestPrice: number | null;
  recentlyAddedAt: number | null;
  releaseDate: number;
  popularityScore: number;
  thumbnailUrl: string;
};
```

### 13.3 Search synchronisation

Never update PostgreSQL and Typesense separately inside a customer request.

Use an outbox pattern:

```
Inventory transaction
        v
PostgreSQL integration event
        v
Queue message
        v
Background worker
        v
Typesense update
```

This prevents database success combined with search-index failure from leaving
the system silently inconsistent.

### 13.4 Search interface

Customer search should support: card names; partial names; spelling mistakes;
set names; set codes; collector numbers; artists; colours; formats; condition;
finish; selected store; in-stock status; price range.

Search requests should be debounced and superseded requests cancelled.

## 14. Product-page performance

Split product-page data into stable and volatile sections.

Stable section, cache aggressively: card identity; rules text; artwork; set;
rarity; artist; legalities; related printings.

Volatile section, fetch separately: current prices; conditions; available
quantity; selected-store stock; click-and-collect availability.

```
Cached product page
        +
Small live availability request
```

Do not invalidate the complete card page whenever one store sells one copy.

## 15. Pricing backend

### 15.1 Provider adapters

Create one adapter interface:

```ts
interface PricingProvider {
  code: string;
  fetchPrices(input: {
    since?: Date;
    printingIds?: string[];
  }): Promise<ImportedPrice[]>;
  healthCheck(): Promise<ProviderHealth>;
}
```

Providers: MTGJSON adapter, TCGplayer adapter, Card Kingdom adapter,
exchange-rate adapter.

### 15.2 Imported price model

```ts
type ImportedPrice = {
  provider: string;
  sourceProductId: string;
  sourceSkuId?: string;
  printingId?: string;
  scryfallId?: string;
  setCode?: string;
  collectorNumber?: string;
  language: string;
  finish: "normal" | "foil" | "etched";
  condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
  priceType: "market" | "low" | "retail" | "buylist" | "recent_sale";
  amount: number;
  currency: string;
  observedAt: string;
};
```

### 15.3 Pricing workflow

```
Download provider data
        v
Store raw import
        v
Validate file completeness
        v
Map provider IDs
        v
Store immutable snapshots
        v
Convert currency
        v
Apply retail pricing rules
        v
Run anomaly checks
        v
Create suggested prices
        v
Auto-approve or staff review
        v
Publish to price book
        v
Reindex affected products
```

### 15.4 Price books

Use a central price book with controlled store overrides:

```
Main retail price book
├── Online store
├── Geelong
├── Bendigo
├── Werribee
└── Ballarat
```

Optional override example: Main price $24.00; event-store override $26.00;
online promotion $21.50.

Do not duplicate all prices once for every store.

### 15.5 Pricing safety

Auto-approval requires: exact product mapping; recent source data; acceptable
price movement; adequate margin; valid currency conversion; no material
provider disagreement; price below the manual-review threshold.

Review triggers: unusually large movement; high-value card; provider
disagreement; missing provider; stale data; uncertain foil or etched match;
negative margin; possible mapping error.

## 16. Payment architecture

Use Stripe Checkout for the initial release.

Payment sequence:

```
Checkout request
        v
Validate cart and reservations
        v
Create pending order
        v
Create Stripe Checkout Session
        v
Customer completes payment
        v
Stripe webhook received
        v
Webhook signature verified
        v
Order marked paid
        v
Reservations converted to allocations
        v
Picking job created
```

Stripe recommends using server-side webhooks to confirm payment completion
rather than relying on the customer's browser redirect. Stripe Checkout
requires less custom payment code than building directly against the
lower-level Payment Intents interface.

Every Stripe webhook event must be stored using its unique event ID. If the
event has already been processed, return success without repeating the
operation.

## 17. Background worker

The worker processes durable queue messages.

Queues: `catalogue-import`, `pricing-import`, `search-index`, `email`,
`restock-alerts`, `order-processing`, `reservation-cleanup`,
`stock-reconciliation`, `report-generation`.

Getting the catalogue downloaded: a `catalogue-import` message importing one
set at a time requires already knowing that set's code, so a discovery step
enumerates MTGJSON's full `SetList` and enqueues one message per set not yet
successfully imported (backlog B-040). Discovery runs on a weekly
`pg_cron` schedule (`weekly-catalogue-discovery`,
`supabase/migrations/20260724000500_schedule_catalogue_discovery.sql`, since
new sets release far less often than prices change) and can also be run
on demand with `pnpm --filter worker enqueue-catalogue-import` for an
immediate backfill/refresh.

Processing the queue: environments that cannot reach the Supabase connection
pooler directly (this includes some CI/agent sandboxes) cannot run the
Node worker against `catalogue-import` at all. The
`process-catalogue-import` Supabase Edge Function
(`supabase/functions/process-catalogue-import/index.ts`) is the
network-isolation-proof alternative — it runs inside Supabase's own network,
reads up to 10 messages per invocation from `pgmq`, fetches each set from
`https://mtgjson.com/api/v5/{CODE}.json` (unwrapping the `{meta, data}`
envelope), and calls the `import_set_and_promote(set_code, set_data)` /
`process_catalogue_card(...)` stored procedures
(`supabase/migrations/20260723130907_catalogue_import_edge_function.sql`
onward) to upsert `sets`, `oracle_cards`, `card_printings`,
`card_identifiers`, and cross-product `sellable_skus` for every
finish/condition combination. `import_set_and_promote` returns a status
object (`{status: 'succeeded' | 'failed', ...}`) rather than raising, so a
per-set failure records a `catalogue_import_runs`/`catalogue_import_errors`
row without rolling back the transaction that row lives in.

The `catalogue_import_edge_function_cron` migration schedules a `pg_cron` +
`pg_net` job (`catalogue-import-worker`, every minute) that invokes the Edge
Function via `net.http_post`, so the queue drains automatically with no
external worker process. `card_printings.finishes` allows `nonfoil`,
`foil`, `etched`, and `signed` (the last one specifically for MTGJSON's
World Championship deck sets and Pro Tour Collector's Edition, which use a
signed-card finish no other set does).

Example worker flow:

```
Read queue message
        v
Mark attempt started
        v
Validate payload
        v
Execute job
        v
Record job result
        v
Archive queue message
```

Failure behaviour: attempt 1 fails → retry after short delay; repeated failure
→ move to failed-jobs queue → alert administrator → preserve payload for
replay.

A customer-facing request should not wait for: an email; a Typesense update; a
catalogue import; a pricing calculation; an external report.

## 18. Authentication and permissions

Roles: `customer`, `store_assistant`, `store_manager`, `warehouse_picker`,
`warehouse_manager`, `inventory_manager`, `pricing_manager`,
`customer_service`, `regional_manager`, `system_admin`, `owner`.

Permission examples: `catalogue.view`, `catalogue.manage`, `inventory.view`,
`inventory.receive`, `inventory.adjust`, `inventory.transfer`,
`inventory.stocktake`, `orders.view`, `orders.pick`, `orders.pack`,
`orders.refund`, `orders.cancel`, `pricing.view`, `pricing.approve`,
`pricing.override`, `stores.view`, `stores.manage`, `users.view`,
`users.manage`.

A role alone is insufficient. Every staff membership needs a scope: one store;
selected stores; region; all stores; entire organisation.

Example: Role Store Manager, Scope Frankston. Role Regional Inventory Manager,
Scope All Victorian stores.

Enable RLS on every table exposed through the Supabase Data API. Index fields
used in RLS policies, such as `organisation_id`, `fulfilment_node_id` and
`user_id`. Supabase specifically recommends indexing policy columns and
applying matching query filters because poorly structured RLS can
significantly increase query time.

Never expose the Supabase service-role key to the browser.

### 18.1 Current implementation status

`staff_has_permission()` checks a `role_permissions` join table mapping
each role to its permissions, but that table shipped with `roles` and
`permissions` seeded individually and no rows ever inserted connecting the
two — every permission check returned false for every role until this was
found. Only the `pricing.*` mappings (`pricing_manager`/`owner`/
`system_admin` → `pricing.view`/`pricing.approve`/`pricing.override`) are
seeded so far, enough to make the pricing review queue's permission checks
actually work. The rest of the matrix in this section — which roles get
`inventory.*`, `orders.*`, `stores.*`, `users.*`, `catalogue.*` — is still
empty and needs its own deliberate pass; that mapping is a product
decision, not something to infer from the role/permission names alone.

Separately: a `SECURITY DEFINER` function's own body must call
`staff_has_permission()` (or an equivalent check) explicitly if it should
be permission-gated — RLS policies on the table it writes to do not apply
to a security-definer function's internal statements, since RLS is not
enforced against the function owner. `approve_suggested_price()`/
`override_suggested_price()`/`reject_suggested_price()` had exactly this
gap (an RLS policy existed and looked like protection, but the functions
themselves never checked anything), which let any authenticated user
approve or override any price until fixed. Any new security-definer
mutation function should check permissions itself, not rely on the target
table's RLS policy alone.

## 19. API and command boundaries

Server Actions: use for authenticated application mutations such as updating
account preferences, creating a restock alert, creating a saved list, staff
form submissions, approving prices.

Route handlers: use for Stripe webhooks, shipping webhooks, external APIs,
health checks, file imports, search-key generation, integration callbacks.

Database commands: use controlled database commands for stock reservation,
stock allocation, transfer dispatch, transfer receipt, order payment
confirmation, issuing store credit, redeeming gift cards.

## 20. Frontend performance rules

Required: Server Components by default; small Client Components; route-level
code splitting; search through Typesense; correctly sized card thumbnails;
lazy loading below the fold; cursor pagination; virtualised staff tables;
optimistic cart feedback; background prefetching; skeleton loading states;
cached stable catalogue content; separate live stock payloads.

Prohibited: loading the full catalogue into React; filtering thousands of
cards in the browser; querying PostgreSQL on every search keystroke; one
database request per search result; full-size images in search grids; offset
pagination across huge tables; one giant global client state; realtime
subscriptions for every public product; recalculating inventory from movement
history per request; revalidating the entire site after every stock change;
calling external pricing services during page rendering.

## 21. Performance database rules

Create indexes for actual access patterns, for example:

```sql
create unique index inventory_balance_node_sku_uq
on inventory_balances (fulfilment_node_id, sellable_sku_id);

create index inventory_balance_sku_node_idx
on inventory_balances (sellable_sku_id, fulfilment_node_id);

create index inventory_available_node_idx
on inventory_balances (fulfilment_node_id, quantity_available_online)
where quantity_available_online > 0;

create index orders_node_status_created_idx
on orders (primary_fulfilment_node_id, status, created_at desc);

create index memberships_user_org_node_idx
on staff_memberships (user_id, organisation_id, fulfilment_node_id);
```

Do not add indexes blindly. Verify frequent queries using execution plans and
database performance tooling.

## 22. Testing structure

Unit tests: pricing calculations; condition modifiers; order-routing scores;
reservation expiry; deck-list parsing; shipping thresholds; gift-card
calculations; store-credit calculations.

Database tests: RLS; staff scope; atomic stock reservations; overselling
prevention; movement and balance consistency; duplicate webhooks; transfer
lifecycle; ledger immutability; refund transactions.

Integration tests: catalogue import; pricing import; Typesense indexing; queue
retries; Stripe webhooks; email generation; shipping integration.

End-to-end tests: search for a card → select condition → add to cart →
complete checkout → order reaches picking; select a store → check local
availability → place click-and-collect order → store completes collection;
receive stock → publish inventory → search index updates → customer sees
stock; transfer stock → source stock decreases → destination receives stock →
destination availability updates; paste deck list → resolve matches → add
available cards to cart.

Playwright can run browser tests across Chromium, Firefox and WebKit,
including mobile-device emulation.

## 23. Performance test data

Testing must use a realistic seeded dataset.

Minimum performance fixture: 1 organisation; 4 stores (no separate
warehouse); 100,000+ printings; 500,000+ sellable SKUs; 1,000,000+
inventory balance records; 5,000,000+ inventory movements; 100,000+
customers; 100,000+ historical orders; 10,000+ active carts.

Performance scenarios: hundreds of simultaneous searches; many customers
purchasing one high-demand card; 100-card deck-list import; store-level
inventory search; bulk price publication; catalogue import during normal
shopping; store transfer receiving; reservation expiry batch; picking 1,000
order lines; repricing 100,000 products.

Track: median; p95; p99; error rate; rows scanned; cache hit rate; queue
delay; search-index delay; database CPU; slow SQL statements.

## 24. Environments

Use four environments: local, development preview, staging, production.

Local: local Next.js; local Supabase through Docker; local Typesense
container; Stripe test mode; local email viewer; seeded fixture data.

Preview: created for feature branches; safe preview database or mocked data;
Stripe test mode; isolated environment variables.

Staging: permanent test environment; dedicated Supabase project; dedicated
Typesense collection; realistic data; Stripe test mode; complete integration
testing.

Production: production database; production search cluster; Stripe live
mode; production email; production monitoring.

Vercel provides Local, Preview and Production environments and supports
branch-based preview deployments. A dedicated staging environment can be
added for longer-running pre-production testing.

Never connect random preview deployments to the production database.

## 25. CI/CD pipeline

Every pull request should run:

```
Install locked dependencies
        v
Type-check
        v
Lint
        v
Unit tests
        v
Database migration test
        v
RLS tests
        v
Build application
        v
Playwright critical-path tests
        v
Create preview deployment
```

Production deployment:

```
Merge to main
        v
Run full CI
        v
Apply database migrations
        v
Deploy worker
        v
Deploy web application
        v
Run smoke tests
        v
Verify health endpoints
        v
Monitor errors
```

Database migrations must run before application code that depends on them.

Prefer backward-compatible migrations:

1. Add new column or table.
2. Deploy code supporting old and new structures.
3. Backfill data.
4. Switch reads and writes.
5. Remove obsolete structure later.

## 26. Documentation for AI-assisted development

`AGENTS.md` rules:

1. Do not alter the database outside migration files.
2. Do not update inventory from React components.
3. Do not expose service credentials to browser code.
4. Do not bypass RLS to resolve permission errors.
5. Do not duplicate existing components or services.
6. Do not place business logic inside page components.
7. Do not add dependencies without recording the reason.
8. Do not remove existing behaviour to simplify implementation.
9. Do not publish prices without anomaly checks.
10. Do not process payment based on browser redirects.
11. Do not directly dual-write PostgreSQL and Typesense.
12. Do not calculate balances from editable fields.
13. Run type-check, lint and relevant tests after every change.
14. Update documentation when business rules change.
15. Keep the storefront fast and measure performance.

`docs/business-rules.md` should contain: inventory availability formula;
reservation duration; fulfilment priorities; store safety-stock rules;
condition definitions; pricing approval thresholds; transfer rules;
cancellation rules; refund rules.

## 27. Step-by-step build process

See `docs/backlog.md` for the individual, dependency-ordered, AI-ready tasks
that implement Steps 1–23 below.

- **Step 1** — Finalise scope and business rules.
- **Step 2** — Create the repository.
- **Step 3** — Establish local infrastructure.
- **Step 4** — Build organisation and store foundations.
- **Step 5** — Build the catalogue importer.
- **Step 6** — Build sellable SKUs.
- **Step 7** — Build inventory transactions.
- **Step 8** — Build store transfers.
- **Step 9** — Build Typesense search.
- **Step 10** — Build the storefront shell.
- **Step 11** — Build card and printing pages.
- **Step 12** — Build cart and reservations.
- **Step 13** — Build checkout and payments.
- **Step 14** — Build order routing.
- **Step 15** — Build staff fulfilment.
- **Step 16** — Build pricing importers.
- **Step 17** — Build the pricing engine.
- **Step 18** — Build customer accounts.
- **Step 19** — Build deck-list purchasing.
- **Step 20** — Build restock and recently-added tools.
- **Step 21** — Add monitoring and security.
- **Step 22** — Run full performance testing.
- **Step 23** — Controlled retail launch.

Each step's "done when" criteria are captured as acceptance criteria on the
corresponding backlog tasks.

## 28. Later development phases

### Buylist phase

After retail is stable: wanted quantities; cash prices; store-credit bonus;
submission tracking; grading; customer approval; payment; conversion into
retail inventory.

### Marketplace phase

Only after retail and buylist are proven: managed consignment; verified
customer inventory; seller accounts; fees; seller ledgers; payouts.

The marketplace must use the existing catalogue, SKU, inventory and
fulfilment systems rather than creating a second commerce platform.

## 29. Final recommended stack

Next.js App Router, TypeScript, React, Tailwind CSS, shadcn/ui, Zod, React
Hook Form, Supabase PostgreSQL, Supabase Auth, Supabase Storage, Supabase
Queues, Supabase Cron, Typesense, Stripe Checkout, Resend, Sentry, Vercel,
containerised background worker, GitHub Actions, Vitest, pgTAP, Playwright.

## 30. Final architecture decision

The platform should remain: one repository; one web application; one
background worker; one authoritative PostgreSQL database; one dedicated
search index.

This provides enough separation to protect storefront performance without
creating a complex microservice environment that is difficult for a
freelance developer to maintain.

The defining competitive advantages should be: faster than MTG MATE; better
search than MTG MATE; clearer condition-level stock; better deck-list
purchasing; true multi-store availability; faster click and collect; better
pricing intelligence; stronger warehouse operations.

### 30.1 Why not a hosted platform (Shopify, etc.)

A hosted e-commerce platform's product/variant model is built for goods with
a handful of simple variants (size, colour) — it does not natively express
this platform's actual unit of sale: printing + language + finish +
condition (§8.3), nor the inventory ledger states a sale must respect
(reserved/allocated/quarantined/safety-stock, §9), nor store-to-store
transfer logistics (§12), nor order routing that prefers one store fulfilling
a whole order over splitting it with a warehouse (§11). These aren't
presentation details a plugin or app layer bolts on; they're the data model
the rest of this platform is built around, and forcing them onto a platform
designed for simpler variants means fighting its assumptions rather than
using them.

The honest tradeoff: a hosted platform gives you PCI compliance surface,
checkout hardening, and uptime for free. Building custom means this backlog
is the cost of owning all of that ourselves. That cost is only worth paying
because the competitive advantages listed above — better search, clearer
condition-level stock, true multi-store availability, better deck-list
purchasing — are specifically the things a generic platform doesn't give you
out of the box.
