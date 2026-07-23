import { sql } from "./db.js";
import { pollCatalogueImportQueue } from "./consumers/catalogue-import-consumer.js";
import { pollStockReconciliationQueue } from "./consumers/stock-reconciliation-consumer.js";

const POLL_INTERVAL_MS = 5_000;

// catalogue_import and stock_reconciliation have consumers wired up so far.
// The other 7 queues from blueprint §17 (pricing_import, search_index,
// email, restock_alerts, order_processing, reservation_cleanup,
// report_generation) exist in Postgres (migration 20260722120349) but have
// no consumer yet — future work, one per backlog step as those domains land.
async function tick(): Promise<boolean> {
  const processedCatalogueImport = await pollCatalogueImportQueue(sql);
  const processedStockReconciliation = await pollStockReconciliationQueue(sql);
  return processedCatalogueImport || processedStockReconciliation;
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
