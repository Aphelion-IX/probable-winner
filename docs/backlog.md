# Phase-One Backlog — Multi-Store Trading Card Retail Platform

This is the retail-MVP backlog derived from `docs/architecture.md` (the development
blueprint). It excludes buylist and marketplace work, which are later phases
(blueprint §28) and must not be pulled forward.

## How to use this backlog

- **ID**: stable identifier, referenced by dependents and by commit/PR titles.
- **Depends on**: tasks that must merge first. A task with unmet dependencies is not
  startable.
- **AC** (Acceptance Criteria): what must be true for the task to be considered done.
- **Tests**: the minimum automated coverage a PR for this task must add.
- Every task also inherits the global Definition of Done from `AGENTS.md`: typecheck,
  lint, and relevant test suites pass; migrations (not manual schema edits) are used
  for any database change; no business logic in page components; no direct
  PostgreSQL/Typesense dual-writes from request handlers.
- Tasks are grouped by phase and map back to blueprint §27 "Step 1–23." Phase order is
  the dependency order — do not start a later phase's tasks before its prerequisite
  phases are functionally done, even if individual tasks look parallel-friendly.

---

## Phase 0 — Foundation (blueprint Steps 1–4)

### Step 1: Scope and business rules

**B-001 Write retail-MVP scope document** — deps: none
- AC: `docs/product-purpose.md` lists in-scope retail features and explicitly excludes marketplace/buylist for phase one; reviewed against blueprint §2.1.
- Tests: none (documentation task); reviewed via PR.

**B-002 Write inventory rules document** — deps: none
- AC: `docs/inventory-rules.md` defines the availability formula (on-hand − reserved − allocated − quarantined − safety stock), reservation duration, and quarantine rules.
- Tests: none; later tasks (B-060+) must implement exactly this formula, so treat mismatches as bugs against this doc.

**B-003 Write pricing rules document** — deps: none
- AC: `docs/pricing-rules.md` defines auto-approval thresholds, review triggers, and price-book override precedence per blueprint §15.5.
- Tests: none.

**B-004 Define order, transfer, and reservation status enums** — deps: none
- AC: `docs/business-rules.md` enumerates every state for orders, transfers, and reservations (blueprint §10, §12) with allowed transitions as a state diagram.
- Tests: none; B-062/B-071/B-124 must implement only the transitions listed here.

**B-005 Write performance budget document** — deps: none
- AC: `docs/performance.md` reproduces the table in blueprint §2.3 and specifies the seeded-data volumes from §23 that all perf tests must run against.
- Tests: none.

### Step 2: Repository and tooling

**B-010 Initialize pnpm workspace with web and worker app skeletons** — deps: none
- AC: `apps/web` (Next.js App Router, TypeScript) and `apps/worker` boot with placeholder routes/entrypoints; `pnpm-workspace.yaml` wires both plus an empty `packages/` tree.
- Tests: `pnpm build` succeeds for both apps.

**B-011 Configure TypeScript strict mode and shared tsconfig** — deps: B-010
- AC: root `tsconfig.base.json` has `strict: true`; both apps and all `packages/*` extend it with no local relaxations.
- Tests: `pnpm typecheck` passes with zero `any`-suppression comments introduced.

**B-012 Configure ESLint and Prettier** — deps: B-010
- AC: shared config in `packages/config`; both apps lint clean; a rule (or documented convention) forbids `"use client"` on files under `app/**/page.tsx` unless justified.
- Tests: `pnpm lint` passes; CI fails on a deliberately-introduced lint violation (verify manually, do not commit it).

**B-013 Set up Vitest, Playwright, and pgTAP scaffolding** — deps: B-010
- AC: `pnpm test` runs Vitest across packages; `tests/e2e` has a Playwright config targeting Chromium+WebKit+mobile emulation; `supabase/tests` has a pgTAP harness runnable via `supabase test db`.
- Tests: one trivial passing test in each of the three frameworks, committed as scaffolding proof.

**B-014 GitHub Actions CI pipeline** — deps: B-011, B-012, B-013
- AC: PR workflow runs install → typecheck → lint → unit tests → migration test → RLS test → build → Playwright critical-path → preview deploy, per blueprint §25.
- Tests: CI is green on the PR that introduces it.

**B-015 Write AGENTS.md** — deps: none
- AC: contains the 15 rules from blueprint §26 verbatim or stricter, plus a pointer to `docs/business-rules.md`.
- Tests: none.

### Step 3: Local infrastructure

**B-020 Local Supabase stack (Docker) with committed migrations directory** — deps: B-010
- AC: `supabase/config.toml` present; `supabase start` boots Postgres, Auth, Storage locally; `supabase/migrations` is empty but wired into CI (B-014).
- Tests: `supabase db reset` succeeds against an empty migrations directory.

**B-021 Local Typesense container** — deps: B-010
- AC: `docker-compose.yml` (or equivalent) starts a Typesense node with a fixed API key for local dev; documented in README.
- Tests: a smoke script creates and deletes a test collection against the local instance.

**B-022 Local email viewer** — deps: B-010
- AC: Resend dev mode or an inbox-catcher (e.g. Inbucket/Mailpit) captures outgoing email locally; `packages/integrations/email` reads target inbox from env.
- Tests: a smoke test sends one templated email and asserts it lands in the local inbox.

**B-023 Unified `pnpm dev` command** — deps: B-020, B-021, B-022
- AC: one command starts Supabase, Typesense, the email viewer, the Next.js app, and the worker; documented exit/cleanup behavior.
- Tests: manual verification only — record the steps in README; CI does not run `pnpm dev`.

**B-024 README quick start** — deps: B-023
- AC: a developer with no prior context can clone, install, and run `pnpm dev` successfully by following the README alone.
- Tests: none; verify by having a second person (or a fresh agent) follow it literally.

### Step 4: Organisation and store foundations

**B-030 Migration: organisations, fulfilment_nodes, addresses, hours, storage_locations** — deps: B-020
- AC: tables match blueprint §8.1 field list including `fulfilment_nodes.type` enum (`store`/`warehouse`/`distribution_centre`/`event_location`) and the flags (`allows_click_collect`, `allows_online_fulfilment`, `allows_transfers`, `dispatch_cutoff`, `safety_stock_policy_id`).
- Tests: pgTAP checks constraints (enum values, required NOT NULLs, FK integrity).

**B-031 Migration: staff_memberships, roles, permissions, role_permissions** — deps: B-030
- AC: role list matches blueprint §18; every `staff_memberships` row carries a scope (single store / selected stores / region / all stores / org) via a nullable `fulfilment_node_id` + a `scope_type` column, not role name alone.
- Tests: pgTAP checks a membership cannot have `scope_type='store'` with a null `fulfilment_node_id`.

**B-032 RLS policies for org/store-scoped tables** — deps: B-031
- AC: RLS enabled on every table exposed via the Data API; policies reference `organisation_id`/`fulfilment_node_id`/`user_id`; those columns are indexed per blueprint §18.
- Tests: pgTAP suite asserts a user scoped to Store A cannot read/write Store B rows, and an org-scoped user can read all stores in their org.

**B-033 Seed script: demo retailer, warehouse, 10 stores, staff users** — deps: B-032
- AC: `supabase/seed.sql` (or a seed script invoked by it) creates 1 organisation, 1 warehouse, 10 stores, and one user per role listed in blueprint §4 seed list (admin, store manager, warehouse user, pricing user).
- Tests: re-running the seed is idempotent (no duplicate-key errors).

**B-034 pgTAP tests: staff scope access control** — deps: B-033
- AC: covers every scope type (store/selected-stores/region/all-stores/org) against representative queries used later by staff features.
- Tests: this task's deliverable is the test suite itself; it must fail if B-032's policies are weakened.

---

## Phase 1 — Catalogue and Inventory Core (Steps 5–8)

### Step 5: Catalogue importer

**B-040 MTGJSON download and staging tables** — deps: B-020
- AC: worker job downloads MTGJSON, writes into staging tables (not live tables); import is resumable if interrupted.
- Tests: integration test with a fixture MTGJSON subset asserts staging rows match fixture counts.

**B-041 Validate staged import** — deps: B-040
- AC: validation rejects an incomplete/corrupt file before touching live tables; failures are recorded in `catalogue_import_errors`.
- Tests: fixture with a deliberately truncated file is rejected with a recorded error, not a partial import.

**B-042 Card identity mapping** — deps: B-041
- AC: `oracle_cards`, `card_identifiers` populated with cross-references (MTGJSON id, Scryfall id) per blueprint §3.3.
- Tests: unit test for the mapping function against known ambiguous cases (e.g. cards with multiple printings sharing an oracle id).

**B-043 Set and printing import (idempotent upsert into live tables)** — deps: B-042
- AC: `sets`, `card_printings` populated; re-running the full import twice produces zero duplicate rows and zero net row-count change on the second run.
- Tests: integration test runs the import twice against the same fixture and diffs row counts (must be zero delta on run 2).

**B-044 Image reference import** — deps: B-043
- AC: `card_images` links printings to the approved external image provider's URLs; missing images are recorded, not fatal.
- Tests: fixture with one printing missing an image completes the import and logs the gap.

**B-045 Import run reporting** — deps: B-043
- AC: `catalogue_import_runs` records start/end time, counts, and links to any `catalogue_import_errors`; a staff-visible summary exists (can be a bare route stub until Step 10 builds the UI).
- Tests: unit test asserts a run with 3 recorded errors surfaces all 3 in the report query.

**B-046 Integration test: full catalogue rebuild is duplicate-free and repeatable** — deps: B-043, B-044, B-045
- AC: running the complete importer three times back-to-back against production-sized fixture data leaves table counts stable after run 1.
- Tests: this task's deliverable is the test itself, wired into CI as a (possibly nightly, not per-PR, given runtime) job.

### Step 6: Sellable SKUs

**B-050 sellable_skus schema and reference tables** — deps: B-043
- AC: `conditions`, `languages`, `finishes` tables seeded per blueprint §8.3; `sellable_skus` has a stable, deterministic id derived from (printing, language, finish, condition) — not a random UUID that changes on regeneration.
- Tests: pgTAP unique constraint test on the (printing, language, finish, condition) tuple.

**B-051 SKU generation job** — deps: B-050
- AC: worker job runs after catalogue import completes (B-046) and generates the full SKU cross-product for new/changed printings only (incremental, not full-table rewrite).
- Tests: integration test: importing one new printing generates exactly the expected new SKU rows and touches zero existing rows.

**B-052 Unit tests: SKU id stability** — deps: B-051
- AC: regenerating SKUs for the same printing on two separate runs yields identical ids.
- Tests: this task's deliverable is the stability test itself.

### Step 7: Inventory transactions

**B-060 inventory_balances and inventory_movements schema** — deps: B-051
- AC: schema matches blueprint §9.1–§9.2 exactly, including all quantity_* columns on `inventory_balances` and all `movement_type` values listed in §9.2.
- Tests: pgTAP constraint tests (movement_type is a checked enum; quantity columns are non-negative).

**B-061 receive_inventory() and adjust_inventory() database functions** — deps: B-060
- AC: both functions lock the target balance row, validate input, write a movement, update the balance, and write an integration event, all inside one transaction, per blueprint §9.3.
- Tests: pgTAP: calling `receive_inventory` twice concurrently on the same SKU/node does not lose an update (row-lock proof).

**B-062 reserve_inventory() and release_inventory_reservation()** — deps: B-061
- AC: reservation cannot exceed available quantity; releasing an already-released reservation is a no-op, not an error; both write movements.
- Tests: pgTAP: two concurrent reservations for the last unit of stock — exactly one succeeds, the other is rejected (this is the core oversell-prevention proof required by blueprint §7 "done" criteria).

**B-063 allocate_order_inventory(), begin_inventory_pick(), complete_inventory_pick()** — deps: B-062
- AC: allocation converts a reservation; pick start/complete transitions are recorded as distinct movement types; a completed pick cannot be re-completed.
- Tests: pgTAP: attempting to complete a pick that was never begun fails with a clear error, not a silent no-op.

**B-064 Quarantine handling** — deps: B-061
- AC: quarantined stock is excluded from `quantity_available_online` and from all reservation/allocation paths.
- Tests: pgTAP: a quarantined unit cannot be reserved even though `quantity_on_hand` is nonzero.

**B-065 Stocktakes and reconciliation** — deps: B-061
- AC: `stocktakes`/`stocktake_lines` capture counted vs. expected quantity; a background reconciliation job (per blueprint §2.5) creates `stocktake_adjustment` movements for variances, never edits `inventory_balances` directly outside the atomic functions.
- Tests: integration test: a stocktake with a −2 variance produces exactly one adjustment movement and a matching balance change.

**B-066 Indexes for inventory access patterns** — deps: B-060
- AC: indexes from blueprint §21 (`inventory_balance_node_sku_uq`, `inventory_balance_sku_node_idx`, `inventory_available_node_idx`) exist and are confirmed via `EXPLAIN` to be used by the actual queries B-084/B-102 issue.
- Tests: a perf test (can piggyback on B-087) asserts the relevant queries use an index scan, not a sequential scan, at fixture scale.

### Step 8: Store transfers

**B-070 Transfer schema** — deps: B-062
- AC: `transfer_orders`, `transfer_order_lines`, `transfer_shipments`, `transfer_receipts` implement the full status lifecycle from blueprint §12 (Draft → Requested → Accepted → Picking → Dispatched → In transit → Partially received → Received).
- Tests: pgTAP: an invalid status transition (e.g. Draft → Received) is rejected.

**B-071 dispatch_transfer() and receive_transfer() database functions** — deps: B-070, B-066
- AC: dispatch removes stock from source availability and marks it in-transit; receipt (including partial receipt) is the only path that makes stock available at the destination.
- Tests: pgTAP — this is the "done" criterion from blueprint §8: stock must never show as available at both the source and destination simultaneously during transit; write a test that asserts this invariant at every stage.

**B-072 Partial receipt, damage, and discrepancy handling** — deps: B-071
- AC: a transfer can be partially received; missing/damaged units are recorded distinctly from received units and do not silently vanish from the ledger.
- Tests: integration test: a transfer of 10 units received as 8 good + 1 damaged + 1 missing reconciles to zero unaccounted units.

---

## Phase 2 — Search and Storefront (Steps 9–13)

### Step 9: Typesense search

**B-080 Typesense collection schema** — deps: B-050
- AC: schema matches the `CardSearchDocument` shape in blueprint §13.2 exactly.
- Tests: schema-validation unit test against a sample document.

**B-081 Full reindex job** — deps: B-080, B-066
- AC: worker job rebuilds the entire collection from Postgres without touching customer-facing traffic; safe to run repeatedly.
- Tests: integration test on fixture data asserts document count matches source SKU count.

**B-082 Outbox: integration_events on inventory/price/catalogue change** — deps: B-061, B-071
- AC: every atomic inventory/pricing function (B-061–B-071, B-160s) writes an `integration_events` row in the same transaction as the domain change — never a separate, non-transactional write.
- Tests: pgTAP: a rolled-back inventory transaction leaves no orphaned integration event.

**B-083 Worker consumer: incremental Typesense update** — deps: B-082
- AC: consumer reads `integration_events` via the queue, updates only the affected Typesense document(s); retries on transient failure per blueprint §17 failure behavior.
- Tests: integration test: one inventory movement produces exactly one Typesense document update, observable within the queue's normal processing latency.

**B-084 Search API route handler** — deps: B-080
- AC: supports name/partial-name/typo/set/collector-number/artist/colour/format/condition/finish/store/in-stock/price-range filters per blueprint §13.4; is a route handler, not a Server Action (per §19).
- Tests: Vitest covering each filter type; Playwright covering debounce + request cancellation behavior in the search box (paired with B-092).

**B-085 Ranking and popularity scoring** — deps: B-084
- AC: popularity score field is computed and updates on a schedule (not per-request); documented in `docs/architecture.md`.
- Tests: unit test on the scoring function with fixed inputs.

**B-086 Store-availability filters** — deps: B-084, B-066
- AC: filtering by "available at store X" or "in stock online" reflects `inventory_balances`-derived data synced via the outbox, not a live Postgres join at query time.
- Tests: integration test: reserving the last unit at a store removes it from that store's filtered results after the outbox round-trip.

**B-087 Performance test: search budgets** — deps: B-081, B-084, B-085, B-086
- AC: search suggestions <150ms and full results <250ms (blueprint §2.3), measured against the seeded dataset from B-210 (median/p95/p99).
- Tests: this task's deliverable is the perf test itself, runnable on demand and in a scheduled CI job.

### Step 10: Storefront shell

**B-090 App layout, nav, and store selector** — deps: B-030
- AC: persistent nav, store selector, cart/account entry points; Server Components by default per blueprint §6/§20.
- Tests: Playwright smoke test for nav rendering on desktop and mobile viewport.

**B-091 Home page** — deps: B-090
- AC: renders as a Server Component; no client-side data fetching waterfall for above-the-fold content.
- Tests: Playwright LCP check against the mobile budget (<2s) using a throttled profile.

**B-092 Search results page and mobile filter sheet** — deps: B-084, B-090
- AC: results page consumes B-084; filters open in a mobile sheet; only the filter controls are Client Components.
- Tests: Playwright: apply a filter, confirm results update and the URL is shareable/bookmarkable.

**B-093 Skeleton and error states** — deps: B-091, B-092
- AC: every data-dependent section has a skeleton and an error boundary; no bare blank screens during load.
- Tests: Playwright: simulate a slow/failing API response and assert the skeleton/error UI appears.

**B-094 Playwright: storefront navigation critical path** — deps: B-090–B-093
- AC: covers home → search → results → card page in one flow, run in CI per B-014.
- Tests: this task's deliverable is the test.

### Step 11: Card and printing pages

**B-100 Card identity page (cached, stable section)** — deps: B-046
- AC: renders rules text, artwork, set, rarity, artist, legalities, related printings; cached aggressively per blueprint §14.
- Tests: Vitest for the cache-key derivation; Playwright for correct rendering.

**B-101 All-printings view** — deps: B-100
- AC: lists every printing of an oracle card with condition-independent summary info.
- Tests: Playwright covers a multi-printing card.

**B-102 Exact-printing page with condition/finish/language selection** — deps: B-101, B-066
- AC: customer can identify the exact SKU being purchased (printing + language + finish + condition), matching blueprint §11 "done" criterion.
- Tests: Playwright: selecting each condition/finish/language combination updates price and availability correctly.

**B-103 Live availability fetch (volatile section)** — deps: B-102, B-086
- AC: availability/price/condition data is fetched separately from the cached shell (blueprint §14); a single store sale does not invalidate the whole cached page.
- Tests: integration test: purchasing the last unit updates only the volatile fetch response, not the cached shell's ETag/revalidation.

**B-104 Restock control UI (stub wired to Step 20 backend)** — deps: B-102
- AC: customer can request a restock alert from the printing page; backend implemented in B-190–B-192.
- Tests: Playwright: submitting the form creates a subscription record (can assert via API, not full notification flow yet).

**B-105 Performance test: product page budgets** — deps: B-100–B-103
- AC: cached product page response <500ms; mobile LCP <2s; mobile INP <200ms (blueprint §2.3), measured at fixture scale.
- Tests: this task's deliverable is the perf test.

### Step 12: Cart and reservations

**B-110 carts/cart_lines schema with guest/customer merge** — deps: B-062
- AC: guest carts persist via a signed cookie/session id; logging in merges the guest cart into the customer cart without data loss.
- Tests: pgTAP/integration: merge produces the union of lines with correct quantities, no duplicates.

**B-111 Add-to-cart Server Action** — deps: B-110, B-062
- AC: calls `reserve_inventory()`; never mutates inventory tables directly from a component (per AGENTS.md rule 2).
- Tests: Vitest for the action's validation; pgTAP confirms a reservation row is created.

**B-112 Reservation expiry scheduled job** — deps: B-111
- AC: Supabase Cron job releases expired reservations on schedule per blueprint §10.
- Tests: integration test: an expired reservation's stock becomes available again after the job runs.

**B-113 Price-change and unavailable-item detection on cart view** — deps: B-111
- AC: cart view flags lines whose price changed or whose reservation is no longer valid, before checkout is reached.
- Tests: integration test: a price change between add-to-cart and cart view is surfaced to the user.

**B-114 Cart recovery** — deps: B-110
- AC: a returning guest (same device/cookie) sees their prior cart contents if reservations haven't expired.
- Tests: Playwright: close and reopen the browser context, cart persists.

**B-115 Test: reservation expiry releases stock correctly** — deps: B-112
- AC: covers the full path from expiry job to Typesense availability update (via the outbox, B-082/B-083).
- Tests: this task's deliverable is the integration test.

**B-116 Performance test: add-to-cart confirmation budget** — deps: B-111
- AC: add-to-cart confirms in <300ms (blueprint §2.3) at fixture scale, including the reservation lock.
- Tests: this task's deliverable is the perf test.

### Step 13: Checkout and payments

**B-120 Delivery vs. click-and-collect selection** — deps: B-110
- AC: checkout flow branches correctly; click-and-collect requires a store with `allows_click_collect = true`.
- Tests: Playwright covers both paths.

**B-121 Address and store selection** — deps: B-120
- AC: address form validated with Zod; store selection filtered to stores that can fulfil the cart (or at least the click-and-collect leg).
- Tests: Vitest for validation schema; Playwright for the selection UI.

**B-122 Pending order creation and checkout revalidation** — deps: B-121, B-113
- AC: checkout revalidates reservation ownership/expiry, current price, shipping method, fulfilment location, address, and total per blueprint §10 "Checkout validation" list, before creating a pending order.
- Tests: integration test: a stale reservation or changed price blocks checkout with a clear error rather than silently charging the old price.

**B-123 Stripe Checkout Session route handler** — deps: B-122
- AC: route handler (not a Server Action, per §19) creates the Checkout Session against the pending order.
- Tests: integration test against Stripe test mode.

**B-124 Stripe webhook handler with event-id idempotency** — deps: B-123
- AC: every webhook event is stored by its unique Stripe event id before processing; a repeat delivery of the same event id returns success without repeating side effects (per blueprint §16 and AGENTS.md rule 10).
- Tests: integration test: delivering the same webhook payload twice results in exactly one paid order and one set of allocations, matching blueprint §13 "done" criterion.

**B-125 Payment confirmation → reservation-to-allocation conversion** — deps: B-124, B-063
- AC: on confirmed payment, reservations convert to allocations and a picking job is created, matching blueprint §16 payment sequence.
- Tests: integration test covering the full sequence from webhook to picking-job creation.

**B-126 Failed-payment handling** — deps: B-124
- AC: a failed/expired Checkout Session releases the associated reservations rather than holding them until natural expiry.
- Tests: integration test: failed payment releases stock promptly.

---

## Phase 3 — Fulfilment and Pricing (Steps 14–17)

### Step 14: Order routing

**B-130 order_allocations schema with routing_reason** — deps: B-063
- AC: schema matches blueprint §11; every allocation decision is persisted and auditable, not recomputed after the fact.
- Tests: pgTAP constraint tests.

**B-131 Routing algorithm** — deps: B-130, B-066
- AC: implements the priority order in blueprint §11 (click-and-collect store → warehouse priority → single complete-order store → minimum nodes → cutoff → transfer time → shipping cost → safety stock → split permission); prefers routing the Melbourne-style "one store can fulfil everything" case over splitting with the warehouse.
- Tests: unit tests for each named scenario in blueprint §11, including the explicit "18 of 20 from warehouse vs. 20 of 20 from Melbourne → route to Melbourne" example.

**B-132 Dispatch cutoff and transfer-time handling** — deps: B-131
- AC: routing respects `dispatch_cutoff` per node and factors in transfer lead time when a transfer would be required to fulfil.
- Tests: unit test: an order placed after cutoff routes to a node that can still ship next business day.

### Step 15: Staff fulfilment

**B-140 Staff orders dashboard** — deps: B-125, B-032
- AC: scoped by staff membership (a store user sees only their store's orders); shows order status per blueprint §17 order-status pipeline.
- Tests: Playwright + RLS test combination confirming scope enforcement.

**B-141 Pick batch generation and location-sorted pick lists** — deps: B-140, B-063
- AC: pick lists are ordered by `storage_locations` to minimize walking distance.
- Tests: unit test on the sort function with a fixture location layout.

**B-142 Scanning and condition confirmation UI** — deps: B-141
- AC: staff can scan/confirm each picked item's condition before packing; discrepancies are flagged, not silently accepted.
- Tests: Playwright covers the scan-and-confirm flow including a mismatch case.

**B-143 Missing-card exception handling** — deps: B-142
- AC: a missing card during picking triggers a defined exception path (partial fulfilment, substitution offer, or refund path) rather than blocking the whole order silently.
- Tests: integration test for the missing-card path.

**B-144 Packing, label generation, and shipment tracking** — deps: B-143
- AC: integrates with the chosen shipping provider adapter (§3.3); shipment/tracking data stored in `shipments`/`shipment_lines`.
- Tests: integration test against the shipping provider's sandbox/mock.

**B-145 Click-and-collect handover flow** — deps: B-143
- AC: staff can mark a collection order as handed over only after identity/order confirmation; updates `collection_orders`.
- Tests: Playwright covers the handover UI.

**B-146 Playwright: paid order reaches shipped with no manual DB changes** — deps: B-140–B-145
- AC: matches blueprint §15 "done" criterion end-to-end.
- Tests: this task's deliverable is the E2E test.

### Step 16: Pricing importers

**B-150 PricingProvider adapter interface** — deps: none (parallel with Phase 1)
- AC: interface matches blueprint §15.1 exactly (`fetchPrices`, `healthCheck`); business logic never depends on a provider's native response shape (AGENTS.md rule — provider adapters only).
- Tests: unit test with a mock provider implementing the interface.

**B-151 MTGJSON price adapter and immutable snapshots** — deps: B-150, B-043
- AC: raw import stored before mapping; `price_snapshots` rows are immutable (no in-place updates); matches the `ImportedPrice` type in blueprint §15.2.
- Tests: integration test with fixture MTGJSON pricing data.

**B-152 TCGplayer / Card Kingdom identifier mapping (adapter stubs)** — deps: B-151
- AC: mapping exceptions for unresolved products are recorded, not dropped silently.
- Tests: unit test for ambiguous/missing mapping cases.

**B-153 Exchange-rate adapter** — deps: B-150
- AC: rates stored with observation timestamps; stale-rate detection feeds into review triggers (B-162).
- Tests: unit test for stale-rate detection threshold.

**B-154 Import reporting and provider health checks** — deps: B-151, B-152, B-153
- AC: `price_import_runs` records per-provider health and failure counts.
- Tests: integration test: a provider outage is recorded without throwing an unhandled error.

**B-155 Integration test: provider failure doesn't corrupt existing prices** — deps: B-154
- AC: matches blueprint §16 "done" criterion — a failed import run leaves the last-known-good prices untouched.
- Tests: this task's deliverable is the test.

### Step 17: Pricing engine

**B-160 pricing_rules and calculated_prices schema** — deps: B-151
- AC: schema supports margin rules, condition modifiers, currency conversion, and stock-based modifiers per blueprint §15.
- Tests: pgTAP constraint tests.

**B-161 Suggested-price calculation** — deps: B-160, B-153
- AC: every suggested price is traceable to the rule/inputs that produced it (blueprint §17 "done" criterion: staff can explain any price).
- Tests: unit tests covering margin, condition modifier, and currency conversion independently and combined.

**B-162 Anomaly checks and auto-approval thresholds** — deps: B-161
- AC: implements all auto-approval conditions and all review triggers listed in blueprint §15.5 exactly.
- Tests: unit test per trigger condition (large movement, high-value card, provider disagreement, missing provider, stale data, uncertain match, negative margin, mapping-error suspicion).

**B-163 Review queue and manual override UI** — deps: B-162, B-032
- AC: staff with `pricing.approve`/`pricing.override` permission can review/override; scoped by permission per Step 4.
- Tests: RLS/permission test: a user without `pricing.approve` cannot approve via a direct API call.

**B-164 Price book publication with store overrides** — deps: B-163
- AC: central price book with per-store override rows, not a fully duplicated price table per store (blueprint §15.4).
- Tests: integration test: an override at one store doesn't affect others' calculated price.

**B-165 Reindex trigger on price publish** — deps: B-164, B-082
- AC: publishing a price writes an integration event consumed by the same outbox path as inventory changes (B-083), not a separate ad hoc sync.
- Tests: integration test: publishing a price updates the Typesense document's price fields.

---

## Phase 4 — Accounts and Demand Tools (Steps 18–20)

**B-170 Customer profile, addresses, and preferred store** — deps: B-030 (Supabase Auth)
- AC: profile schema integrates with Supabase Auth; preferred store used to default store selection (B-090).
- Tests: integration test for profile CRUD under RLS (a user can only edit their own profile).

**B-171 Order history and tracking** — deps: B-125, B-144
- AC: customer can view past orders and current shipment tracking status.
- Tests: RLS test: a customer cannot view another customer's orders.

**B-172 Saved lists** — deps: B-170
- AC: `saved_lists`/`saved_list_lines` support adding printings/SKUs for later purchase.
- Tests: Vitest + integration test for add/remove.

**B-173 Communication preferences** — deps: B-170
- AC: customer can opt in/out of restock, price-alert, and marketing email categories independently.
- Tests: integration test: opting out of one category doesn't suppress others.

**B-174 Guest checkout parity test** — deps: B-122, B-170
- AC: confirms guest checkout has no added latency or missing functionality versus authenticated checkout (blueprint §18 "done" criterion).
- Tests: this task's deliverable is a Playwright comparison test.

**B-180 Decklist parser** — deps: none (parallel)
- AC: handles common list format variants (quantity + name, with/without set codes) per blueprint §19.
- Tests: unit tests covering at least 5 real-world format variants.

**B-181 Exact matching against catalogue/SKUs (batched)** — deps: B-180, B-050
- AC: a 100-card list resolves via batched queries, not one query per line (blueprint §19 "done" criterion and §20 prohibited list).
- Tests: integration test asserting query count stays flat (not linear in list size) as list length grows.

**B-182 Ambiguous-match resolution UI** — deps: B-181
- AC: customer can disambiguate between multiple printings/finishes matching one line.
- Tests: Playwright covers a list with at least one ambiguous line.

**B-183 Printing substitution, condition preference, and budget controls** — deps: B-182
- AC: customer can set a max budget and preferred condition; substitutions are proposed when the preferred SKU is unavailable.
- Tests: unit tests for the substitution/budget logic.

**B-184 Fulfilment percentage and add-all-to-cart** — deps: B-183, B-111
- AC: shows what percentage of the list can currently be fulfilled before committing to cart.
- Tests: integration test: add-all-to-cart reserves exactly the resolved lines, matching the previewed fulfilment percentage.

**B-185 Performance test: 100-card list resolution** — deps: B-181–B-184
- AC: resolves without the N+1 query pattern prohibited in blueprint §20, within a reasonable latency budget documented in `docs/performance.md`.
- Tests: this task's deliverable is the perf test.

**B-190 restock_subscriptions / price_subscriptions schema** — deps: B-170
- AC: supports exact-printing, any-printing, store-scoped, condition-scoped, and price-threshold subscriptions per blueprint §20.
- Tests: pgTAP constraint tests.

**B-191 Subscription creation UI** — deps: B-190, B-104
- AC: wires up the stub from B-104; customer can create/cancel subscriptions.
- Tests: Playwright covers create and cancel.

**B-192 Queue-driven notification job** — deps: B-191, B-082
- AC: notifications are triggered via the queue on receive/adjust events, never inline in the receiving request handler (blueprint §20 "done" criterion, §2.5).
- Tests: integration test: receiving stock does not add measurable latency to the receiving endpoint even with many matching subscriptions queued.

**B-193 Recently-added feed** — deps: B-046, B-080
- AC: surfaces newly catalogued/received items via Typesense, not a live Postgres scan per request.
- Tests: integration test for feed correctness and ordering.

---

## Phase 5 — Hardening and Launch (Steps 21–23)

**B-200 Sentry integration (web + worker)** — deps: B-010
- AC: errors from both apps report to Sentry with environment tagging (local/preview/staging/production).
- Tests: manual verification — trigger a test error in each app and confirm it appears in Sentry.

**B-201 Structured logging** — deps: B-200
- AC: consistent log format across web and worker; correlates to request/job ids.
- Tests: unit test for the logger's formatting function.

**B-202 Queue, import, and search-index delay monitoring** — deps: B-083, B-154
- AC: dashboards/alerts exist for queue backlog age, import failures, and Typesense sync lag.
- Tests: integration test: an artificially delayed queue message triggers the alert condition in a test environment.

**B-203 Rate limiting on public endpoints** — deps: B-084, B-123
- AC: search and checkout-adjacent endpoints have rate limits sized to the perf budgets in §2.3 without blocking legitimate burst traffic (e.g. a popular restock).
- Tests: integration test: exceeding the limit returns a defined error, not a crash.

**B-204 Audit log coverage review** — deps: B-061, B-071, B-124, B-163
- AC: every state-changing atomic function (inventory, transfers, payments, pricing approvals) writes to `audit_events`.
- Tests: checklist-style test asserting each listed function produces an audit row in its integration test.

**B-205 Secrets management audit** — deps: B-200
- AC: confirms the Supabase service-role key and Stripe secret key never reach browser bundles (AGENTS.md rule 3); documented in `docs/security.md`.
- Tests: a bundle-analysis check (can be a CI grep/step) fails the build if a service-role key pattern appears in client bundle output.

**B-206 Backup verification job** — deps: B-020
- AC: scheduled job confirms database backups are restorable, not just taken.
- Tests: a documented (possibly manual/staging-only) restore drill, logged in `docs/deployment.md`.

**B-210 Realistic seed generator for performance testing** — deps: B-046, B-051, B-060
- AC: generates the volumes in blueprint §23 (100k+ printings, 500k+ SKUs, 1M+ balances, 5M+ movements, 100k+ customers, 100k+ historical orders, 10k+ active carts) across 10 stores + 1 warehouse.
- Tests: this task's deliverable is the generator; verify row counts meet the stated minimums.

**B-211 Load test suite against performance budgets** — deps: B-210, B-087, B-105, B-116, B-185
- AC: covers every scenario listed in blueprint §23 (concurrent searches, one hot card under contention, 100-card decklist import, store-level staff search, bulk repricing, catalogue import during live shopping, transfer receiving, reservation-expiry batch, 1,000-line picking, repricing 100k products); tracks median/p95/p99/error rate/cache hit rate/queue delay/index delay/DB CPU/slow queries.
- Tests: this task's deliverable is the load-test suite, runnable on demand against staging.

**B-212 SQL and index optimization pass** — deps: B-211
- AC: every budget violation found by B-211 is traced to a specific query plan and resolved (index, query rewrite, or caching); re-run B-211 to confirm.
- Tests: before/after `EXPLAIN` comparison for each fixed query, committed as evidence in the PR.

**B-213 Bundle and image optimization pass** — deps: B-211
- AC: mobile LCP/INP budgets from §2.3 are met on the seeded dataset; card thumbnails are correctly sized (not full-size images in grids, per §20 prohibited list).
- Tests: Playwright/Lighthouse-style perf assertion in CI.

**B-214 RLS overhead measurement and optimization** — deps: B-211, B-032
- AC: RLS-related query overhead is measured directly (not assumed) and policy columns are confirmed indexed per blueprint §18.
- Tests: `EXPLAIN` comparison of a representative query with RLS on vs. a superuser bypass, documented in the PR.

**B-220 Internal staff testing checklist** — deps: Phase 0–4 substantially complete
- AC: staff exercise every workflow in blueprint §22 end-to-end checklist manually before any customer-facing pilot.
- Tests: none automated; produces a signed-off checklist artifact.

**B-221 One-store pilot rollout** — deps: B-220
- AC: feature-flagged or config-gated rollout to exactly one store; rollback path documented.
- Tests: monitoring dashboards (B-202) actively watched during the pilot window.

**B-222 Warehouse pilot** — deps: B-221
- AC: warehouse fulfilment/transfers exercised live with the pilot store.
- Tests: same monitoring approach as B-221.

**B-223 Click-and-collect pilot** — deps: B-222, B-145
- AC: real customers complete click-and-collect at the pilot store.
- Tests: monitored manually; incidents logged.

**B-224 Limited customer release with monitoring runbook** — deps: B-223
- AC: `docs/deployment.md` includes a runbook for on-call response during the limited release.
- Tests: none beyond live monitoring.

**B-225 Full rollout to remaining stores** — deps: B-224
- AC: all 10 stores activated; blueprint §23 explicitly forbids activating all stores on day one, so this is the final step, not a parallelizable one.
- Tests: post-rollout smoke test across all stores.

---

## Explicitly out of scope for this backlog

Per blueprint §28, do not create tasks for buylist (wanted quantities, cash prices,
grading, store-credit bonus conversion) or marketplace (seller accounts, consignment,
payouts, fees) work in this phase. Those become their own backlogs once Phase 5 is
live and stable.
