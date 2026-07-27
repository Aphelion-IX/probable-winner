# Security

Backlog B-205. Documents the secrets-management audit required before launch
(blueprint §24) and the rule every future PR touching credentials must keep
true: the Supabase service-role key and the Stripe secret key never reach
browser code (AGENTS.md rule 3).

## Audit result (2026-07-23)

Searched `apps/web` and `apps/worker` for any reference to a service-role or
Stripe secret key. Result: **no server-only secret is referenced anywhere in
application code today.**

- `apps/web/src/server/supabase.ts` — the only Supabase client factory in the
  web app — reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  only. Both are safe to ship to the browser: the anon key has no privileges
  beyond what RLS grants, by design.
- No file in the repository references `SUPABASE_SERVICE_ROLE_KEY` or
  `STRIPE_SECRET_KEY`. Stripe integration has not been implemented yet
  (checkout is still a placeholder page) — this document sets the rule
  *before* that code lands, not after.
- `apps/worker` connects to Postgres directly via `DATABASE_URL`
  (`apps/worker/src/db.ts`), not through the Supabase Data API, so it has no
  occasion to hold the service-role key either.

This is a point-in-time result, not a standing guarantee — see "Ongoing
enforcement" below for what keeps it true as the codebase grows.

## Rules for future code

1. **Never prefix a server-only secret with `NEXT_PUBLIC_`.** Next.js inlines
   any `NEXT_PUBLIC_*` env var into the client bundle at build time — that
   prefix is an explicit, irreversible "ship this to every browser" opt-in.
   The service-role key and Stripe secret key must be named without it (e.g.
   `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`) and read only from
   server-only code: Route Handlers, Server Actions, and `apps/worker`.
2. **Never import a server-only client into a `"use client"` file**, even
   transitively. If a service-role client is added (e.g. for an admin
   operation that must bypass RLS — rare, and should itself be questioned
   against AGENTS.md rule 4), put it in its own module under `src/server/`
   and never import that module from a Client Component.
3. **The Stripe secret key belongs in a Route Handler or Server Action only**,
   for creating PaymentIntents/Checkout Sessions and verifying webhooks
   (AGENTS.md rule 10: payment state changes only on a verified webhook, keyed
   by the webhook's unique event id — never on a client redirect). The
   publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) is the only Stripe
   key that belongs in browser code.
4. **Local `.env` files are never committed.** There is currently no
   `.env.example` in the repo; when one is added (tracked separately), it
   must list variable names only, never real values.

## SECURITY DEFINER functions are the hole next to RLS

RLS coverage on this schema is complete — every table in `public` has RLS
enabled, and the handful with no policies (`catalogue_staging_*`,
`integration_events`, `price_*`) are worker-internal and therefore deny-all
to `anon`/`authenticated`. The weak spot is not the policies; it is the
functions that deliberately step around them.

A `SECURITY DEFINER` function runs as its owner and **bypasses RLS**. If it
is also `EXECUTE`-able by `anon`, it is an unauthenticated read of whatever
it touches, no matter how good the policies are.

**Prefer `SECURITY INVOKER`.** A function that only reads tables which
already carry correct policies does not need `DEFINER` — running as the
invoker gets the right answer from RLS for free, with no bespoke check to
keep in sync. Reach for `DEFINER` only when the function must do something
the caller genuinely cannot (write the immutable ledger, bypass a guest
cart's absent RLS), and then authorise inside the body.

### Never let a parameter share a name with a column

This is what went wrong in practice. `20260724080000` declared:

```sql
create function get_order_allocations(order_id uuid) ...
  from order_lines ol where ol.order_id = order_id;   -- BOTH SIDES ARE THE COLUMN
```

The predicate reads `ol.order_id = ol.order_id` — true for every row. As a
`SECURITY DEFINER` function granted to `anon`, a single unauthenticated RPC
with any uuid returned **every order line in the database** (confirmed
against the live project: 325,305 rows for an order id that did not exist).
`customer_has_orders()` had the identical defect.

Note *why* it survived review: the sibling `verify_order_allocation_complete()`
was written with a `p_` prefix, because it is **plpgsql**, where an ambiguous
reference raises under the default `variable_conflict = error`. The two
broken functions are **`LANGUAGE SQL`**, which has no such guard — the column
silently wins. The safety net that caught the collision in one function does
not exist in the other.

**Rule: prefix every function parameter with `p_`.** It costs nothing and is
the only reliable defence in `LANGUAGE SQL` functions. Fixed in
`20260725210000`, with regression tests in
`supabase/tests/database/order_function_parameter_shadowing.test.sql`.

### Keep EXECUTE grants tight

- Trigger and event-trigger functions should not be callable over the Data
  API at all. Revoking `EXECUTE` does not affect trigger firing — Postgres
  checks that privilege when the trigger is created, not each time it fires.
- RLS helpers (`staff_has_node_access`, `staff_has_org_access`,
  `staff_has_permission`) follow one pattern: `revoke ... from public, anon`
  then `grant ... to authenticated`, because policies calling them are
  evaluated as the invoking role. `staff_has_permission` was added later than
  its siblings and missed this until `20260725210000`.

## Checkout resource ownership

Carts and orders are reached by an id supplied by the browser, and the
checkout paths use the **service-role** client (they must: guest carts have
no RLS policy, because `auth.uid()` cannot identify an anonymous guest). RLS
is therefore *not* the boundary on these paths — an explicit ownership check
is, and it has to be written by hand on every one of them.

Both resources use the same two-owner model: `customer_id` for a signed-in
customer, `guest_token` for a guest holding the httpOnly `cart_session_id`
cookie. `apps/web/src/server/checkout-ownership.ts` is the single
implementation:

- `resolveCheckoutIdentity()` — who the request is acting as. Reads the
  cookie **without creating one**; minting a token inside an authorisation
  check would hand the caller a fresh identity mid-check.
- `ownsResource(resource, identity)` — fails closed. Every branch requires a
  non-null value on both sides before comparing, so an ownerless row and an
  identity-less caller can never satisfy a `null === null` match.

**Any new endpoint that takes a cart or order id from the client must call
these before touching the row**, and should return the same "not found" it
would for a genuinely missing id — confirming that an id exists but belongs
to someone else is itself a leak.

Historical note: `createPendingOrder()` and `POST /api/checkout/sessions`
originally had no such check, so passing any cart/order id turned a
stranger's basket into an order, or opened a Stripe session exposing their
order contents and totals. Compounding it, `createPendingOrder()` never
populated `orders.customer_id`, so orders were created ownerless — which
also meant `orders_select_customer` matched nothing and customers could
never see their own order history. Fixed together in
`20260725180000_orders_guest_token.sql` and the checkout ownership module;
orders predating that migration stay ownerless and unclaimable by design.

## Staff permissions (blueprint §18)

`staff_has_permission(code)` resolves a permission through the signed-in
user's active `staff_memberships` row → `role_permissions` → `permissions`.
It is the gate on privileged database functions (pricing approval/override)
and on the staff screens' server actions.

**The role × permission matrix is seeded in migrations, not managed at
runtime.** `20260724221000_seed_pricing_role_permissions.sql` seeded the
`pricing.*` grants; `20260725160000_seed_role_permission_matrix.sql` seeded
every other domain. Before the latter, `role_permissions` held only pricing
rows, so `staff_has_permission()` returned false for `inventory.*`,
`orders.*`, `stores.*` and `users.*` for **every** role including `owner` —
any surface gated on them was unreachable. Adding a new permission to the
`permissions` table is therefore only half the job: it must also be granted
to the roles that need it, in the same migration.

Three layers enforce access, and only the first two are real:

1. **RLS** — the boundary. Policies use `staff_has_node_access()` /
   `staff_has_org_access()` / `staff_has_permission()`.
2. **Server actions** — check the permission before calling an RPC, so a
   refusal is a readable message rather than a policy violation.
3. **Nav filtering** (`visibleNavSections()` in
   `apps/web/src/components/layout/staff-nav-links.ts`) — presentation only.
   Hiding a link is *not* access control; it stops the sidebar advertising
   screens whose every action would be refused.

Two caveats worth knowing when writing a staff query:

- **`inventory_balances` has a public read policy** for every active node
  (`20260725120000`, so the storefront can show availability). RLS will
  *not* scope it to the viewer's stores — staff queries against it must
  filter on `staffContext.nodeIds` explicitly.
- **`profiles` / `customer_addresses` are staff-readable only with
  `users.view`** (`20260725170000`), and read-only: customers remain the
  sole writers of their own records.

## Ongoing enforcement

A hand-audit doesn't stay true on its own, so it's backed by an automated
check, not just this document:

- `apps/web/scripts/check-client-bundle-secrets.mjs` scans every file in
  `apps/web/.next/static` after `next build` for:
  - the literal env var names `SUPABASE_SERVICE_ROLE_KEY` and
    `STRIPE_SECRET_KEY` (their presence in client JS means source code
    referencing them got bundled for the browser, which is a smell even
    before any real value is involved), and
  - the Stripe secret key value shape (`sk_live_…` / `sk_test_…`), which
    would indicate an actual leaked credential regardless of how it got
    there.
- Wired into CI (`.github/workflows/ci.yml`) as the "Check for leaked secrets
  in client bundle" step, immediately after `pnpm run build` — a violation
  fails the build, the same way a lint or typecheck failure would.
- Run it locally with `pnpm --filter web run check:secrets` after a build.

When the Stripe integration and any service-role-key usage (e.g. an admin
tool) are added, extend `FORBIDDEN_NAMES` / `FORBIDDEN_VALUE_PATTERNS` in
that script for the new secret's env var name and value shape, the same way
`STRIPE_SECRET_KEY` is covered today even though nothing reads it yet.

## Audit trail (B-204)

Every state-changing atomic function in `supabase/migrations/20260724140000_audit_events.sql`
writes a row to `audit_events` (organisation, actor, action, entity, metadata)
in the same transaction as the change it's recording, so a rolled-back call
never leaves an orphaned audit row — same reasoning as the `integration_events`
outbox. Covered today: every inventory function (receive, adjust, reserve,
release, allocate, begin/complete pick, quarantine, release quarantine),
both transfer functions (dispatch, receive), and all six pricing approval
functions (approve, override, reject, publish, set override, clear override).

Payments has no atomic functions yet — checkout is still a placeholder page
— so there's nothing to wire up there. When payment confirmation (blueprint
B-124) lands, its webhook handler should call `record_audit_event()` the
same way, inside the same transaction as the payment state change.

`audit_events` is staff-readable (RLS scoped by `staff_has_org_access()`,
same policy shape as `published_prices`) but has no direct-write policy —
`record_audit_event()` is a `security definer` function locked down to be
callable only from other `security definer` atomic functions, not directly
from the Data API.

## Re-audit (2026-07-26): the inventory/order trust boundary

A follow-up audit found that the checkout ownership checks above (route
handlers, `createPendingOrder()`) were sound, but several lower-level
Supabase RPC functions were still directly callable over the Data API and
bypassed them. Fixed in `20260726030000`, `20260726040000` and
`20260726050000`:

1. **`reserve_inventory()`/`release_inventory_reservation()` had no caller
   check at all** — deliberately deferred when they were written
   (`20260723055815`) until `carts` existed to check ownership against.
   Carts have existed since `20260723070153`, but the deferred revoke never
   happened: an anonymous caller could reserve arbitrary stock (making a SKU
   look sold out) or release *any* reservation by guessing its uuid,
   freeing a stranger's cart. Both functions are now revoked from
   `anon`/`authenticated` entirely — every legitimate caller reaches them
   only through the cart functions below (or `create_pending_order()`),
   which are themselves `SECURITY DEFINER` and so are unaffected by the
   revoke.

2. **Guest-cart IDOR**: `add_to_cart()`, `update_cart_line_quantity()`,
   `remove_cart_line()` and `merge_guest_cart_into_customer_cart()` only
   checked ownership `if v_cart.customer_id is not null` — unconditionally
   skipped for every guest cart, since a guest cart's `customer_id` is null
   by definition. Anyone who obtained a guest cart id or cart-line id (plain
   uuids, already visible to the browser) could mutate another guest's
   basket. Fixed by adding the same `p_guest_token` parameter
   `get_cart_contents()` already used for reads (`20260724230000`) to every
   guest-cart write, verified against the httpOnly `cart_session_id` cookie
   server-side — never accepted as free-form browser input.

3. **`persist_order_allocations()` was granted to `authenticated`** despite
   its own comment claiming it was server/service-role-only. Superseded
   entirely (see below) rather than re-granted.

4. **`confirm_order_payment()`/`release_failed_order_reservations()` matched
   a reservation by `sellable_sku_id` alone**, joining `order_lines` to
   *any* cart holding that SKU — flagged as a known limitation when first
   written (`20260724160000`) and, separately, still declared their
   parameter as bare `order_id`, which is ambiguous against
   `order_lines.order_id` under plpgsql's `variable_conflict = error` — so
   every real call raised an exception before completing anything.
   Payment confirmation had, in effect, never worked. Fixed by having
   `order_lines` carry `inventory_reservation_id` directly (see below) and
   renaming parameters `p_`-prefixed, the same fix already applied to
   `get_order_allocations()`/`customer_has_orders()` in `20260725210000`.
   The reservation → allocation conversion is now inlined rather than
   calling `allocate_order_inventory()`, because that function gates on
   `staff_has_node_access()` — meaningless for a service-role webhook, which
   has no `auth.uid()`, so it would have failed that check on every call
   even after the parameter fix. `confirm_order_payment()`'s trust boundary
   is its `EXECUTE` grant (`service_role` only), not a staff check — the
   same shape `reserve_inventory()` already uses.

5. **Order creation was five separate privileged writes**, not one
   transaction: address, order, order lines, `persist_order_allocations()`,
   then a total update. A failure partway through any of them left partial
   rows behind (an address with no order, an order stuck at its $0
   placeholder, lines with no allocations). Replaced with one
   `SECURITY DEFINER` function, `create_pending_order()` — one transaction,
   nothing to roll back by hand.

6. **Click-and-collect allocations were rewritten to the customer's chosen
   store regardless of which node the line's stock was actually reserved
   at** (cart lines are always reserved from a single default online store
   today — there's no "pick your store" flow before checkout yet), so an
   allocation could claim stock at a store that never held it.
   `create_pending_order()` now releases the original reservation and
   reserves the same quantity at the collection store instead when they
   differ, which fails (and rolls back the whole order, via the same
   check-constraint oversell guard `reserve_inventory()` always enforced) if
   that store doesn't actually have the stock.

Regression tests: `supabase/tests/database/reserve_and_release_inventory.test.sql`
(permission boundary), `cart_functions.test.sql` (guest-token IDOR),
`atomic_pending_order_creation.test.sql` (atomicity, click-and-collect
re-reservation, exact reservation matching in `confirm_order_payment()`),
plus `apps/web/src/app/actions/__tests__/create-pending-order*.test.ts` and
`apps/web/src/app/api/webhooks/stripe/route.test.ts` on the application side.

Two follow-ups from this list have since been closed, as their own
separate pieces of work rather than folded into the RPC-lockdown pass
above:

- **CI** (`.github/workflows/ci.yml`) now starts a real local Supabase
  stack, resets it (every migration + `seed.sql`), and runs `supabase test db`
  (pgTAP/RLS regressions) as a blocking step; Build and the Playwright suite
  point at that real stack instead of an unreachable placeholder project,
  and the E2E job is no longer `continue-on-error`. Stripe and Typesense
  remain placeholders (no CI-provisioned test account or search service
  exists), so specs needing either still fall back to their own graceful
  skip guards.
- **The picking → packing → shipment pipeline** is wired end to end
  (`20260726060000_wire_up_picking_packing_shipment_workflow.sql`):
  `record_pick_line_scan()` is the real Server Action call behind the
  picking page's "Mark as picked" button, converting a fully-scanned line's
  allocation via `begin_inventory_pick()`/`complete_inventory_pick()`
  instead of only updating React state; `complete_pick_batch()` now refuses
  to complete a batch with any unpicked line; a real packing detail page
  exists at `apps/web/src/app/staff/packing/[id]/page.tsx` (previously a
  404, per the fulfilment E2E spec); and `begin_pick_batch()`/
  `create_shipment()`/`generate_shipment_label()`/`mark_shipment_shipped()`
  each move every order the batch covers through
  `picking → packed → dispatched → shipped` (per `docs/business-rules.md`'s
  existing status diagram), with `mark_shipment_shipped()` also writing the
  customer-facing `shipments` table it never touched before. Regression
  tests: `supabase/tests/database/pick_pack_ship_workflow.test.sql`.

**Not fixed in this pass** (tracked as follow-up work, not because it's
lower severity than the above — it's a larger, separable project):

- The Stripe webhook returns `5xx` when `confirm_order_payment()`/
  `release_failed_order_reservations()` fail, so Stripe retries instead of
  considering the event delivered — but nothing yet moves verified events
  into a durable inbox processed by a retryable worker, which blueprint §16
  calls for eventually.
