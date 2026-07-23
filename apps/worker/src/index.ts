import { sql } from "./db.js";
import { pollCatalogueImportQueue } from "./consumers/catalogue-import-consumer.js";

const POLL_INTERVAL_MS = 5_000;

// Only catalogue_import has a consumer wired up so far. The other 8 queues
// from blueprint §17 (pricing_import, search_index, email, restock_alerts,
// order_processing, reservation_cleanup, stock_reconciliation,
// report_generation) exist in Postgres (migration 20260722120349) but have
// no consumer yet — future work, one per backlog step as those domains land.
async function tick(): Promise<boolean> {
  return pollCatalogueImportQueue(sql);
}

async function main() {
  console.log("worker started, polling queues...");
  for (;;) {
    const processed = await tick();
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

main().catch((error) => {
  console.error("worker crashed:", error);
  process.exit(1);
});
