import { sql } from "../db.js";
import { reindexTypesense } from "../jobs/reindex-typesense.js";

// One-off/manual entry point: run `pnpm --filter worker reindex-search` to
// rebuild the entire Typesense index from the current Postgres state. Safe
// to run repeatedly (backlog B-081's "done" criterion) — see
// reindex-typesense.ts for why this upserts rather than delete+recreate.
reindexTypesense(sql)
  .then((result) => {
    if (result.status === "failed") {
      console.error(`reindex failed after ${result.durationMs}ms: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `reindex complete: ${result.documentsIndexed} documents indexed, ${result.documentsFailed} failed, in ${result.durationMs}ms`,
    );
  })
  .catch((error) => {
    console.error("reindex failed:", error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
