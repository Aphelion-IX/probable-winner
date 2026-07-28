import { callAdminEndpoint } from "../search/admin-client.js";

// One-off/manual entry point: run `pnpm --filter worker reindex-search` to
// rebuild the entire search index from the current Postgres state, in the
// live worker process (via its admin HTTP endpoint -- see admin-client.ts
// for why this can't just rebuild locally). Safe to run repeatedly (backlog
// B-081's "done" criterion): the live index keeps serving the old documents
// until the rebuild completes, then swaps over.
callAdminEndpoint<{ documentCount: number; durationMs: number }>("/admin/reindex")
  .then((result) => {
    console.log(`reindex complete: ${result.documentCount} documents indexed in ${result.durationMs}ms`);
  })
  .catch((error) => {
    console.error("reindex failed:", error);
    process.exitCode = 1;
  });
