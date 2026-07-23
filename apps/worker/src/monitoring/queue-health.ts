import type { Sql } from "postgres";

// B-202: queue backlog age monitoring, covering all 9 pgmq queues from
// blueprint §17. catalogue_import/pricing_import/pricing_publish/
// stock_reconciliation have consumers wired up (apps/worker/src/index.ts);
// search_index/email/restock_alerts/order_processing/reservation_cleanup do
// not yet, but their queue depth is still worth watching -- a growing
// backlog on search_index today is exactly the metric that will matter once
// a Typesense sync consumer exists (backlog B-083), since it's a direct
// proxy for search-index sync lag even before that consumer is built.
export const MONITORED_QUEUES = [
  "catalogue_import",
  "pricing_import",
  "search_index",
  "email",
  "restock_alerts",
  "order_processing",
  "reservation_cleanup",
  "stock_reconciliation",
  "report_generation",
] as const;

// docs/performance.md: "Queue depth: Supabase Queues (pgmq) backlog age
// monitored; alerts on > 5 min staleness."
export const QUEUE_STALENESS_THRESHOLD_SECONDS = 5 * 60;

export interface QueueMetrics {
  queueName: string;
  queueLength: number;
  oldestMsgAgeSeconds: number | null;
}

export interface QueueHealthResult {
  queueName: string;
  healthy: boolean;
  queueLength: number;
  oldestMsgAgeSeconds: number | null;
  reason?: string;
}

// Pure and DB-free so it can be unit tested directly with synthetic
// "artificially delayed" metrics, without needing a live Postgres/pgmq
// connection.
export function evaluateQueueHealth(
  metrics: QueueMetrics,
  thresholdSeconds: number = QUEUE_STALENESS_THRESHOLD_SECONDS,
): QueueHealthResult {
  if (metrics.oldestMsgAgeSeconds !== null && metrics.oldestMsgAgeSeconds > thresholdSeconds) {
    return {
      queueName: metrics.queueName,
      healthy: false,
      queueLength: metrics.queueLength,
      oldestMsgAgeSeconds: metrics.oldestMsgAgeSeconds,
      reason: `oldest message is ${metrics.oldestMsgAgeSeconds}s old, exceeding the ${thresholdSeconds}s staleness threshold`,
    };
  }

  return {
    queueName: metrics.queueName,
    healthy: true,
    queueLength: metrics.queueLength,
    oldestMsgAgeSeconds: metrics.oldestMsgAgeSeconds,
  };
}

interface PgmqMetricsRow {
  queue_name: string;
  queue_length: number;
  oldest_msg_age_sec: number | null;
}

export async function fetchQueueMetrics(sql: Sql): Promise<QueueMetrics[]> {
  const rows = await sql<PgmqMetricsRow[]>`
    select queue_name, queue_length, oldest_msg_age_sec
    from pgmq.metrics_all()
    where queue_name = any(${MONITORED_QUEUES})
  `;

  const byName = new Map(rows.map((row) => [row.queue_name, row]));

  // Include every monitored queue even if pgmq has no metrics row for it
  // yet (an empty queue that's never been read from) -- report it as
  // healthy with zero length rather than silently omitting it.
  return MONITORED_QUEUES.map((queueName) => {
    const row = byName.get(queueName);
    return {
      queueName,
      queueLength: row?.queue_length ?? 0,
      oldestMsgAgeSeconds: row?.oldest_msg_age_sec ?? null,
    };
  });
}

export async function checkQueueHealth(
  sql: Sql,
  thresholdSeconds: number = QUEUE_STALENESS_THRESHOLD_SECONDS,
): Promise<QueueHealthResult[]> {
  const metrics = await fetchQueueMetrics(sql);
  return metrics.map((m) => evaluateQueueHealth(m, thresholdSeconds));
}
