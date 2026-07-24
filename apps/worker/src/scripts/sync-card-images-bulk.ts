import { sql } from "../db.js";
import { syncCardImagesFromBulkData } from "../jobs/sync-card-images-bulk.js";

// Full-catalogue image sync: run `pnpm --filter worker sync-card-images-bulk`
// to backfill/refresh card_images for every printing with a known
// scryfall_id, via Scryfall's daily bulk-data export (default_cards)
// rather than one /cards/collection request per 75 printings. Intended as
// a periodic (e.g. daily) scheduled job once this environment has a
// scheduler wired up for it -- see import-card-images.ts's script for the
// smaller, immediate-freshness alternative.
syncCardImagesFromBulkData(sql)
  .then((result) => {
    console.log(
      `bulk card image sync complete: ${result.imagesUpserted} images upserted, ` +
        `${result.printingsMatched} of ${result.knownPrintings} known printings matched ` +
        `(${result.cardsScanned} Scryfall cards scanned)`,
    );
  })
  .catch((error) => {
    console.error("bulk card image sync failed:", error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
