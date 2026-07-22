# Feature modules

Per `docs/architecture.md` §7, each feature owns its own types, validation,
queries, commands, components, and tests:

```
features/inventory/
├── components/
├── queries/
├── actions/
├── schemas/
├── services/
├── tests/
└── index.ts
```

No features exist yet — this repo is still in Phase 0/1 of `docs/backlog.md`.
Business-critical logic (inventory, pricing, checkout) belongs in a feature's
`services/`/`actions/`, never inline in a page component or a UI component.
