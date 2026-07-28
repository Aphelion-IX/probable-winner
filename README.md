# Pullhouse

Multi-store trading-card retail platform.

- [`docs/architecture.md`](docs/architecture.md) — development stack and build blueprint.
- [`docs/backlog.md`](docs/backlog.md) — phase-one backlog: dependency-ordered, AI-ready tasks with acceptance criteria and test requirements.

## Local development

Search (B-021, blueprint §24) runs on MiniSearch, hosted inside `apps/worker`
itself — there's no separate service to start. Run the worker:

```
pnpm --filter worker dev
```

Then set `SEARCH_SERVICE_URL`/`SEARCH_SERVICE_TOKEN` in `apps/web/.env.local`
and `SEARCH_SERVICE_PORT`/`SEARCH_SERVICE_TOKEN`/`SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` in `apps/worker/.env.local` (see the `.env.example`
files in each app — the token must match on both sides), and populate the
index with:

```
pnpm --filter worker reindex-search
```
