# Product Purpose and Scope — Multi-Store Trading Card Retail Platform

This document defines the retail-MVP scope and explicitly excludes marketplace/buylist features for Phase 1.

## In-Scope Features (Retail MVP)

### Catalogue and Inventory Management
- **Catalogue import**: MTGJSON and external provider data integration
- **SKU management**: Deterministic SKU generation from (card printing, language, finish, condition) tuples
- **Inventory tracking**: On-hand, reserved, allocated, quarantined, and safety-stock quantities
- **Stocktakes and reconciliation**: Variance detection and adjustment workflows
- **Store transfers**: Inter-store stock movements with dispatch/receive lifecycle

### Pricing Engine
- **Price sourcing**: MTGJSON, TCGplayer, Card Kingdom, Cardmarket providers
- **Currency conversion**: Exchange rates with hourly refresh
- **Pricing rules**: Margin, condition modifiers, stock-band modifiers
- **Anomaly detection**: Auto-approval and staff-review triggers
- **Price book publication**: Central prices with store-level overrides
- **Full traceability**: Every suggested price links back to source data and calculation inputs

### Customer Experience
- **Storefront**: Browse catalogue, filter by card properties and store location
- **Cart**: Guest and authenticated carts, persistent across login
- **Reservation**: Stock reservation with automatic expiry and release
- **Checkout**: Stripe Checkout integration with webhook confirmation
- **Orders**: Order status tracking, picking workflow, shipment dispatch/receipt
- **Search**: Typesense full-text search with live indexing

### Store Operations
- **Click-and-collect**: In-store pickup with inventory allocation
- **Online fulfilment**: Shipping with tracking integration
- **Staff portal**: Order management, inventory adjustment, pricing review, reports
- **Access control**: Role-based permissions scoped by store, region, or organisation
- **Audit logging**: Full change history for compliance

## Explicitly Out-of-Scope (Phase 1)

### Buylist / Acquisition
- **Customer buylist submissions**: "Sell us your cards" workflow
- **Buylist pricing and grading**: Automated or manual card valuation for acquisition
- **Buylist order fulfillment**: Processing customer-submitted cards

### Marketplace / P2P Trading
- **Seller accounts**: Vendors selling alongside retail inventory
- **Marketplace listings**: User-generated product offers
- **Commission and payout**: Multi-party settlement
- **Dispute resolution**: Marketplace arbitration

### Advanced Features
- **Subscription services**: Restock alerts (queued for Phase 2, not active)
- **Price history analytics**: Historical price tracking and trends
- **Promotional campaigns**: Automated discount scheduling and targeting
- **Customer segmentation**: Behavioural cohorts and personalization
- **Wholesale accounts**: B2B ordering, bulk discounts, account credit

## Phase 1 Goals

The retail MVP focuses on being the **fastest, most reliable way to buy Magic cards in bulk locally** by region or online, with **transparent pricing** tied to real market data and **expert staff curation** via the pricing review queue.

Success criteria:
- Customers find and reserve cards within 3 clicks
- Storefront load time < 2 seconds (P95, 4G)
- Staff approval/override of prices within 5 minutes (mean latency, includes queue depth)
- Zero inventory double-sell across concurrent requests
- Full audit trail for every transaction
