import "./instrument.js";
import * as Sentry from "@sentry/node";
import { sql } from "./db.js";
import { logger } from "./logger.js";
import { pollCatalogueImportQueue } from "./consumers/catalogue-import-consumer.js";
import { pollStockReconciliationQueue } from "./consumers/stock-reconciliation-consumer.js";
import { pollPricingImportQueue } from "./consumers/pricing-import-consumer.js";
import { pollPricingPublishQueue } from "./consumers/pricing-publish-consumer.js";
import { checkQueueHealth } from "./monitoring/queue-health.js";
import { checkImportFailures } from "./monitoring/import-health.js";

const POLL_INTERVAL_MS = 5_000;
// B-202: health checks are far cheaper to run than a queue drain, but
// running them every 5s poll tick would be excessive — once a minute is
// enough to catch a >5min staleness threshold with room to spare.
const HEALTH_CHECK_INTERVAL_MS = 60_000;

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

// B-202: queue backlog age + import failure monitoring. Unhealthy results
// are logged and sent to Sentry as messages (not exceptions — nothing
// "threw", the system is just falling behind) so they show up as alertable
// events without needing a separate dashboard stack.
async function runHealthChecks(): Promise<void> {
  try {
    const queueResults = await checkQueueHealth(sql);
    for (const result of queueResults) {
      if (!result.healthy) {
        logger.warn("queue backlog exceeds staleness threshold", {
          queue: result.queueName,
          queueLength: result.queueLength,
          oldestMsgAgeSeconds: result.oldestMsgAgeSeconds,
        });
        Sentry.captureMessage(`Queue "${result.queueName}" backlog stale: ${result.reason}`, {
          level: "warning",
          tags: { queue: result.queueName },
        });
      }
    }

    const importResults = await checkImportFailures(sql);
    for (const result of importResults) {
      if (result.failedRunCount > 0) {
        logger.warn("import pipeline has recent failed runs", {
          source: result.source,
          failedRunCount: result.failedRunCount,
          mostRecentFailureAt: result.mostRecentFailureAt,
        });
        Sentry.captureMessage(
          `${result.source} has ${result.failedRunCount} failed run(s) in the last 24h`,
          { level: "warning", tags: { source: result.source } },
        );
      }
    }
  } catch (error) {
    // The health check itself failing (e.g. a transient DB error) is a real
    // exception, unlike an unhealthy-but-successful check above.
    logger.error("health check failed", { error: logger.serializeError(error) });
    Sentry.captureException(error);
  }
}

async function main() {
  logger.info("worker started, polling queues");
  let lastHealthCheckAt = 0;

  for (;;) {
    const processed = await tick();

    const now = Date.now();
    if (now - lastHealthCheckAt >= HEALTH_CHECK_INTERVAL_MS) {
      lastHealthCheckAt = now;
      await runHealthChecks();
    }

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
