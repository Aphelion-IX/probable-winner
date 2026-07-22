# Agent rules for this repository

This is a pnpm workspace for a multi-store trading-card retail platform. Read
`docs/architecture.md` (the full development blueprint) and `docs/backlog.md`
(the phase-one task backlog) before making non-trivial changes.

## Framework version note

`apps/web` runs **Next.js 16**, which has breaking changes vs. older training
data — most notably: `middleware.ts` is renamed `proxy.ts` (same behavior,
new name/convention), and there is a new opt-in **Cache Components** model
(`cacheComponents` flag) that changes how `fetch`/`unstable_cache` caching is
reasoned about. Before writing caching or routing code, check
`apps/web/node_modules/next/dist/docs/01-app/` for the current convention
rather than assuming an older Next.js API.

## Hard rules

1. Do not alter the database outside migration files (`supabase/migrations`).
2. Do not update inventory from React components — call a Server Action or
   database command that invokes an atomic function (`reserveInventory()`,
   never manual arithmetic in a component).
3. Do not expose service credentials (Supabase service-role key, Stripe
   secret key, etc.) to browser code.
4. Do not bypass RLS to resolve permission errors — fix the policy or the
   membership/scope data instead.
5. Do not duplicate existing components or services — search `packages/`
   and `apps/*/src/features` first.
6. Do not place business logic inside page components (`app/**/page.tsx`).
7. Do not add dependencies without recording the reason (commit message or
   PR description).
8. Do not remove existing behaviour to simplify implementation.
9. Do not publish prices without anomaly checks (see `docs/pricing-rules.md`
   once it exists, and blueprint §15.5).
10. Do not process payment based on browser redirects — confirm via Stripe
    webhook only, keyed by the webhook's unique event ID.
11. Do not directly dual-write PostgreSQL and Typesense from a request
    handler — use the outbox pattern (integration event → queue → worker).
12. Do not calculate balances from editable fields — `inventory_balances` is
    derived from the immutable `inventory_movements` ledger via the atomic
    database functions in blueprint §9.3.
13. Run typecheck, lint, and relevant tests after every change
    (`pnpm typecheck && pnpm lint && pnpm test` from the repo root).
14. Update documentation (`docs/`) when business rules change.
15. Keep the storefront fast and measure performance — see the budgets in
    blueprint §2.3 / `docs/performance.md`.

## Repository layout

- `apps/web` — Next.js App Router storefront + staff portal + Server Actions +
  route handlers.
- `apps/worker` — background worker (not yet scaffolded; see backlog B-011).
- `packages/*` — shared domain logic, database access, search, integrations
  (not yet scaffolded).
- `supabase/` — migrations, seed data, edge functions (not yet scaffolded).
- `docs/` — architecture blueprint and backlog.
