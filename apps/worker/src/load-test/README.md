# B-211: Load test suite

Runs the performance scenarios listed in blueprint §23 / `docs/performance.md`
against a seeded database and reports median/p95/p99 latency, error rate,
cache hit rate, queue delay, and slowest statements.

## Prerequisites

- The database must be seeded to at least the volumes B-210 targets — run
  `supabase/seed_perf_test.sql` and `supabase/seed_perf_test_operational.sql`
  first (see their headers for how; they're executed via the Supabase MCP
  `execute_sql` tool against a live project, not `supabase db reset`, since
  the target volumes need a real database).
- `DATABASE_URL` set to that project's direct Postgres connection string
  (same variable `apps/worker`'s consumers use — see `.env.example`).
- `pg_stat_statements` and `pgmq` extensions enabled (used for the
  slowest-statements and queue-delay parts of the health snapshot; both are
  already enabled on this project).

## Running

```bash
# All scenarios
pnpm --filter worker load-test

# One or more specific scenarios
pnpm --filter worker load-test hot-card-contention store-level-staff-search
```

Available scenario names: `concurrent-searches`, `hot-card-contention`,
`decklist-import`, `store-level-staff-search`, `bulk-repricing`,
`catalogue-import-during-shopping`, `transfer-receiving`,
`reservation-expiry-batch`, `1000-line-picking`, `repricing-100k-products`.

Exit code is non-zero if any scenario's error rate exceeds 5%.

## Scenario coverage

Of blueprint §23's 10 load-test scenarios, 8 run real load against real
code paths (application-level atomic functions where one exists —
`reserve_inventory()`/`release_inventory_reservation()`,
`receive_transfer()`, `release_expired_reservations()` — direct table
reads/writes matching the real access pattern otherwise). Two are reported
as `BLOCKED` rather than faked, because the feature behind them doesn't
exist yet in this codebase:

- **Concurrent searches** — the storefront's `/search` page is still a
  placeholder; Typesense integration (backlog Step 9, B-080-087) was never
  built, and this environment has no Typesense credentials to build
  against (a pre-existing, documented constraint — see PR #4).
- **100-card decklist import** — the decklist-import feature (parser,
  batched matching, disambiguation UI, substitution/budget,
  add-all-to-cart — backlog B-180-184) doesn't exist yet.

Re-run the suite once those features land to fill in the remaining two
rows; nothing about the harness needs to change, since `SCENARIOS` in
`scenarios.ts` is just a name→function map.

## Notes

- **Database CPU** isn't queryable from SQL on this managed Postgres —
  cross-reference the Supabase dashboard/API for that metric during a real
  run; everything else blueprint §23 asks to track (rows scanned via
  `EXPLAIN`, cache hit rate, queue delay, slow SQL) is in the health
  snapshot printed before/after the run.
- **Repeated runs deplete some scenarios' seed data** — `transfer-receiving`
  and `1000-line-picking` consume `transfer_orders`/`pick_lines` rows that
  aren't left in a re-usable state (a received transfer stays received; a
  picked line stays picked). Re-seed (or extend
  `seed_perf_test_operational.sql`'s phase O3/O4 volumes) before re-running
  those two after they've exhausted their pool.
- **`bulk-repricing`** writes `final_amount = final_amount` (a no-op value
  update) rather than a real recalculated price — the point of that
  scenario is publish-write throughput under concurrency, not correctness
  of the calculation; `repricing-100k-products` is the one that exercises
  the actual formula.
