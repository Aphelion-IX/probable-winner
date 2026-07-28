# Deployment

Backlog B-206. Documents the environment topology (blueprint §24), the CI/CD
pipeline (blueprint §25) as it exists today, and the backup-restore drill
required before launch.

## Environments (blueprint §24)

| Environment | Database | Search | Payments | Notes |
|---|---|---|---|---|
| Local | Local Supabase (Docker) | `pnpm --filter worker dev` builds/persists the index; `apps/web` reads the snapshot directly | Stripe test mode | `pnpm dev`; seeded fixture data |
| Preview | Safe preview database or mocked data | — | Stripe test mode | One per feature branch (Vercel) |
| Staging | Dedicated Supabase project | Dedicated worker deployment builds/persists the index | Stripe test mode | Realistic data; full integration testing |
| Production | Production database | Production worker deployment (Railway/Render/equivalent) builds/persists the index; `apps/web` (Vercel) reads it directly from Storage | Stripe live mode | Production monitoring (Sentry, see `docs/security.md`) |

Search reads run inside `apps/web`'s own Vercel functions (there is no
separate search service to reach at request time) -- but the worker still
has to run to actually produce and keep updating the Storage snapshot those
functions read. See the gap note below.

Never connect a preview deployment to the production database.

## CI/CD pipeline (blueprint §25)

Current state of `.github/workflows/ci.yml`, run on every pull request:

```
Install locked dependencies
        v
Format check
        v
Type-check
        v
Lint
        v
Unit tests
        v
Build application
        v
Check for leaked secrets in client bundle (B-205)
        v
Install Playwright browsers
        v
E2E tests
```

**Gap, not yet closed:** the blueprint §25 pipeline also calls for a
"Database migration test" and "RLS tests" step. `supabase/tests/database/`
has pgTAP coverage for migrations, RLS policies, and (as of B-204) audit
log coverage, but no CI step actually runs `supabase test db` — the pgTAP
suite only runs if someone invokes it locally against a Docker-backed local
Supabase stack. Wiring this in needs Docker-in-CI (`supabase start` inside
the GitHub Actions runner) and is tracked as follow-up work, not yet
implemented.

Production deployment (once staging exists): merge to main → run full CI →
apply database migrations → deploy worker → deploy web application → run
smoke tests → verify health endpoints (`/api/health`) → monitor errors
(Sentry, B-200).

**Gap, not yet closed:** "deploy worker" above is not yet a concrete,
running deployment anywhere in this repo's history -- `apps/web` has a real
Vercel project, but `apps/worker` has never been deployed to Railway/
Render/equivalent (the tech stack's own recommendation) or any other host.
This was already true before search moved onto MiniSearch (catalogue
import, pricing import, restock alerts, etc. all need the worker running
too), but it now also means the search-index Storage snapshot `apps/web`
depends on (§13.1) is never produced or updated -- no snapshot ever
existed for it to download, so search has nothing to serve, not merely
stale results. Search itself needs no separate deployment or env var on
`apps/web`'s side (it reads Supabase Storage directly with the same anon
key everything else already uses); the entire remaining gap is standing up
somewhere for `apps/worker` to actually run continuously.

## Backup verification (B-206)

Supabase takes automatic backups of the project database (frequency and
retention depend on the project's plan — see the Supabase dashboard's
Database → Backups page for the specific project). A backup that has never
been restored is not a verified backup — "confirms backups are restorable,
not just taken" is the actual requirement (backlog B-206), and that can only
be checked by actually restoring one.

### Restore drill runbook

Run this drill on a recurring schedule (recommended: monthly, and always
before a launch milestone) against **staging only, never production**:

1. **Identify a backup to restore.** In the Supabase dashboard for the
   staging project, go to Database → Backups and note the most recent
   automatic backup's timestamp.
2. **Restore into a new branch/project, not in place.** Use Supabase's
   "restore to a new project" (or branching, if enabled for the project) —
   never restore over the live staging database, since that destroys
   whatever staging currently holds.
3. **Verify the restored database, not just that the restore command
   succeeded:**
   - Row counts on a handful of core tables (`organisations`,
     `fulfilment_nodes`, `orders`, `inventory_balances`) are non-zero and in
     the right ballpark for what staging held at backup time.
   - `select count(*) from inventory_movements` and
     `select count(*) from audit_events` (B-204) are non-zero — these are
     the two append-only ledgers everything else derives from, so their
     presence is a good proxy for "the restore is a real point-in-time
     copy, not an empty schema."
   - One representative RLS check (a staff user scoped to a single store
     can query their own store's `inventory_balances` and cannot query
     another store's) still passes against the restored copy — a restore
     that silently drops policies is a resurfaced RLS-off state, not just
     stale data.
4. **Time the restore.** Record how long the restore took, start to
   query-ready. This is a real recovery-time input and should be tracked
   over time to catch first if it starts trending up as the database grows.
5. **Tear down the restored project/branch** once verification is done —
   don't leave a second copy of production-shaped data sitting around.
6. **Log the drill.** Append a row to the table below in this document:
   date, backup timestamp restored, restore duration, pass/fail on each
   verification check, and who ran it.

### Drill log

| Date | Backup timestamp | Restore duration | Row-count check | RLS check | Run by |
|---|---|---|---|---|---|
| _(none yet — first drill is a launch-blocking task, backlog B-206/B-220)_ | | | | | |

### What's automatable vs. what isn't

The row-count and RLS checks above (steps 3) can be scripted as a SQL file
run against the restored database's connection string once one exists —
worth doing once staging is provisioned, since it turns "did someone
remember to check" into a pass/fail script. The restore trigger itself
(steps 1-2) is a Supabase dashboard/CLI action tied to a specific project
and billing plan, not something this repository's CI can drive without
credentials scoped to destroy/recreate a Supabase project — that part
stays a manual, logged drill rather than a scheduled CI job.
