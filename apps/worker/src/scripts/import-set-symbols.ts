import { sql } from "../db.js";
import { importSetSymbols } from "../jobs/import-set-symbols.js";

// One-off/backfill entry point: run `pnpm --filter worker import-set-symbols`
// to fetch and store Scryfall's expansion-icon URL + scryfall_id for every
// set row (both columns already existed on `sets`, unpopulated). Safe to
// re-run.
importSetSymbols(sql)
  .then((result) => {
    console.log(
      `set symbol import complete: ${result.iconsUpserted} icons upserted across ${result.setsProcessed} sets (${result.unmatched} unmatched)`,
    );
  })
  .catch((error) => {
    console.error("set symbol import failed:", error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
