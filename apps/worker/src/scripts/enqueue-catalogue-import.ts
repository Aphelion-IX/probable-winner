import { sql } from "../db.js";
import { discoverAndEnqueueSets } from "../jobs/discover-catalogue-sets.js";

// One-off/backfill entry point for "how do I get the catalogue downloaded":
// run `pnpm --filter worker enqueue-catalogue-import` to fetch MTGJSON's
// full SetList and enqueue a catalogue_import message per set not already
// imported. The same discovery logic also runs automatically on the weekly
// cron (migration 20260724000500_schedule_catalogue_discovery.sql); this
// script exists for triggering it immediately rather than waiting.
discoverAndEnqueueSets(sql)
  .then((result) => {
    console.log(
      `catalogue discovery: enqueued ${result.enqueued} of ${result.totalSets} sets (${result.alreadyImported} already imported)`,
    );
  })
  .catch((error) => {
    console.error("catalogue discovery failed:", error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
