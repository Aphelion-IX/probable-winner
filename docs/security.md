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
