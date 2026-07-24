# probable-winner

Multi-store trading-card retail platform.

- [`docs/architecture.md`](docs/architecture.md) — development stack and build blueprint.
- [`docs/backlog.md`](docs/backlog.md) — phase-one backlog: dependency-ordered, AI-ready tasks with acceptance criteria and test requirements.

## Local development

Search (B-021, blueprint §24) runs against Typesense. Start it locally with:

```
docker compose up typesense
```

Then set `TYPESENSE_HOST`/`TYPESENSE_PORT`/`TYPESENSE_PROTOCOL`/`TYPESENSE_API_KEY`
in `apps/web/.env.local` and `apps/worker/.env.local` (see the `.env.example`
files in each app), and populate the index with:

```
pnpm --filter worker reindex-search
```
