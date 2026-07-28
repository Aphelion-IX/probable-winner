# Pullhouse

Multi-store trading-card retail platform.

- [`docs/architecture.md`](docs/architecture.md) — development stack and build blueprint.
- [`docs/backlog.md`](docs/backlog.md) — phase-one backlog: dependency-ordered, AI-ready tasks with acceptance criteria and test requirements.

## Local development

Search (B-021, blueprint §24) runs on MiniSearch. `apps/worker` builds the
index and persists a snapshot to Supabase Storage; `apps/web` downloads that
snapshot directly and caches it in memory — there's no separate search
service `apps/web` needs to be pointed at. Set `SEARCH_SERVICE_PORT`/
`SEARCH_SERVICE_TOKEN`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in
`apps/worker/.env.local` (see `apps/worker/.env.example`), run the worker,
and populate the index:

```
pnpm --filter worker dev
pnpm --filter worker reindex-search
```
