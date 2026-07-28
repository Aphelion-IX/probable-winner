import "./instrument.js";
import * as Sentry from "@sentry/node";
import { sql } from "./db.js";
import { logger } from "./logger.js";
import { pollCatalogueImportQueue } from "./consumers/catalogue-import-consumer.js";
import { pollStockReconciliationQueue } from "./consumers/stock-reconciliation-consumer.js";
import { pollPricingImportQueue } from "./consumers/pricing-import-consumer.js";
import { pollSearchIndexQueue } from "./consumers/search-index-consumer.js";
import { pollRestockAlertsQueue } from "./consumers/restock-alerts-consumer.js";
import { pollEmailQueue } from "./consumers/email-consumer.js";
import { checkQueueHealth } from "./monitoring/queue-health.js";
import { checkImportFailures } from "./monitoring/import-health.js";
import { startSearchHttpServer } from "./search/http-server.js";
import {
  loadSnapshotFromStorage,
  persistSnapshotToStorage,
  rebuildFullIndex,
} from "./search/index-store.js";

const POLL_INTERVAL_MS = 5_000;
// B-202: health checks are far cheaper to run than a queue drain, but
// running them every 5s poll tick would be excessive — once a minute is
// enough to catch a >5min staleness threshold with room to spare.
const HEALTH_CHECK_INTERVAL_MS = 60_000;
// MiniSearch's index lives in this process's memory (unlike Typesense, an
// external service) -- a periodic snapshot to storage bounds how much
// incremental (queue-driven) drift a crash/restart could lose to this
// interval, without paying the cost of re-uploading the several-hundred-MB
// snapshot on every single incremental update.
const SNAPSHOT_PERSIST_INTERVAL_MS = 30 * 60_000;

// catalogue_import, stock_reconciliation, pricing_import, search_index,
// restock_alerts, and email have consumers wired up. There is no separate
// "pricing_publish" queue or consumer (B-165's AC is explicit: publishing a
// price must go through the same outbox path as inventory changes, not a
// separate ad hoc sync) — pricing_published/pricing_approved/
// pricing_overridden events are read from the same search_index queue as
// every other integration event, via search-index-consumer.js. A prior
// pricing-publish-consumer.ts existed here polling
// pgmq.read("integration_events", ...), a table name, not an actual pgmq
// queue — it never read a real message and never touched Typesense;
// removed. restock_alerts (B-190-192) drains messages emitted by
// emit_integration_event() (inventory changes) and publish_suggested_price()
// (price changes) — see restock-alerts-consumer.js. email drains
// order_confirmation messages ('order_paid', confirm_order_payment()) and
// shipment_notification messages ('order_shipped', mark_shipment_shipped())
// — both via the same emit_integration_event() path (see email-consumer.js)
// — the queue existed since migration 20260722120349 but nothing ever
// wrote a message to it before these. Real shipping-carrier API
// integration (label generation/tracking) is not attempted here — it
// needs a real, provider-specific business account this environment has
// no credentials for; staff still enter the tracking number/label
// manually. The remaining 2 queues from blueprint §17 (order_processing
// and report_generation — reservation expiry itself already runs via
// pg_cron, migration 20260723070907, not the reservation_cleanup queue)
// exist in Postgres but have no producer or consumer yet — future work
// for Phase 4 and beyond.
const queues = [
  { name: "catalogue_import", poll: pollCatalogueImportQueue },
  { name: "stock_reconciliation", poll: pollStockReconciliationQueue },
  { name: "pricing_import", poll: pollPricingImportQueue },
  { name: "search_index", poll: pollSearchIndexQueue },
  { name: "restock_alerts", poll: pollRestockAlertsQueue },
  { name: "email", poll: pollEmailQueue },
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
      logger.error("queue consumer failed", {
        queue: queue.name,
        error: logger.serializeError(error),
      });
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

// Loads the last persisted snapshot for a fast start; falls back to a full
// rebuild from Postgres (the always-correct path) when no snapshot exists
// yet or loading one fails for any reason -- see index-store.ts's own
// comments on why the snapshot is a best-effort accelerator, not a hard
// dependency.
async function loadOrRebuildSearchIndex(): Promise<void> {
  const loaded = await loadSnapshotFromStorage();
  if (loaded) {
    logger.info("search index loaded from storage snapshot");
    return;
  }

  logger.info("no usable search index snapshot -- rebuilding from Postgres");
  const result = await rebuildFullIndex(sql);
  logger.info("search index rebuilt from Postgres", result);
}

async function main() {
  logger.info("worker started, polling queues");
  let lastHealthCheckAt = 0;
  let lastSnapshotPersistAt = Date.now();

  await loadOrRebuildSearchIndex();
  startSearchHttpServer(sql);

  for (;;) {
    const processed = await tick();

    const now = Date.now();
    if (now - lastHealthCheckAt >= HEALTH_CHECK_INTERVAL_MS) {
      lastHealthCheckAt = now;
      await runHealthChecks();
    }

    if (now - lastSnapshotPersistAt >= SNAPSHOT_PERSIST_INTERVAL_MS) {
      lastSnapshotPersistAt = now;
      await persistSnapshotToStorage();
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
