import { callAdminEndpoint } from "../search/admin-client.js";

// One-off/manual entry point: run `pnpm --filter worker update-popularity-scores`
// to recompute and push popularity_score for every SKU already in the live
// search index (backlog B-085, blueprint §13.6 -- updates on a schedule,
// not per-request), via the worker's admin HTTP endpoint (see
// admin-client.ts for why this can't just run locally).
type PopularityScoringResult =
  | { status: "completed"; updated: number; failed: number }
  | { status: "failed"; error: string };

callAdminEndpoint<PopularityScoringResult>("/admin/recalculate-popularity-scores")
  .then((result) => {
    if (result.status === "failed") {
      console.error(`popularity scoring failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `popularity scoring complete: ${result.updated} updated, ${result.failed} not yet indexed`,
    );
  })
  .catch((error) => {
    console.error("popularity scoring failed:", error);
    process.exitCode = 1;
  });
