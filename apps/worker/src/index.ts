import "./instrument.js";
import * as Sentry from "@sentry/node";
import { sql } from "./db.js";
import { logger } from "./logger.js";
import { pollCatalogueImportQueue } from "./consumers/catalogue-import-consumer.js";
import { pollStockReconciliationQueue } from "./consumers/stock-reconciliation-consumer.js";
import { pollPricingImportQueue } from "./consumers/pricing-import-consumer.js";
import { pollPricingPublishQueue } from "./consumers/pricing-publish-consumer.js";

const POLL_INTERVAL_MS = 5_000;

// catalogue_import, stock_reconciliation, pricing_import, and pricing_publish have
// consumers wired up. The other 5 queues from blueprint §17 (search_index,
// email, restock_alerts, order_processing, reservation_cleanup, report_generation)
// exist in Postgres (migration 20260722120349) but have no consumer yet — future
// work for Phase 4 and beyond.
const queues = [
  { name: "catalogue_import", poll: pollCatalogueImportQueue },
  { name: "stock_reconciliation", poll: pollStockReconciliationQueue },
  { name: "pricing_import", poll: pollPricingImportQueue },
  { name: "pricing_publish", poll: pollPricingPublishQueue },
];

// A single queue consumer throwing should not take down the whole worker
// process — report it to Sentry and let the other queues keep draining.
async function tick(): Promise<boolean> {
  let processedAny = false;
  for (const queue of queues) {
    try {
      const processed = await queue.poll(sql);
      processedAny = processedAny || processed;
    } catch (error) {
      logger.error("queue consumer failed", { queue: queue.name, error: logger.serializeError(error) });
      Sentry.captureException(error, { tags: { queue: queue.name } });
    }
  }
  return processedAny;
}

async function main() {
  logger.info("worker started, polling queues");
  for (;;) {
    const processed = await tick();
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

main().catch(async (error) => {
  logger.error("worker crashed", { error: logger.serializeError(error) });
  Sentry.captureException(error);
  await Sentry.flush(2000);
  process.exit(1);
});
