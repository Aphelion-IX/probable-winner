import { sql } from "../db.js";
import { importCardImages } from "../jobs/import-card-images.js";

// One-off/backfill entry point: run `pnpm --filter worker import-card-images`
// to fetch and store Scryfall image URLs for every card_printing that has a
// known scryfall_id (populated by the MTGJSON-based catalogue importer) but
// no card_images rows yet. Safe to re-run -- already-imaged printings are
// skipped.
importCardImages(sql)
  .then((result) => {
    console.log(
      `card image import complete: ${result.imagesUpserted} images upserted across ${result.printingsProcessed} printings (${result.notFound} not found on Scryfall)`,
    );
  })
  .catch((error) => {
    console.error("card image import failed:", error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
