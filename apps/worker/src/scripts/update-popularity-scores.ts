import { sql } from "../db.js";
import { updateAllPopularityScores } from "../jobs/calculate-popularity-score.js";

// One-off/manual entry point: run `pnpm --filter worker update-popularity-scores`
// to recompute and push popularity_score for every SKU already in the
// Typesense index (backlog B-085, blueprint §13.6 — updates on a schedule,
// not per-request).
updateAllPopularityScores(sql)
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
  })
  .finally(() => sql.end());
