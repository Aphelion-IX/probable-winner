"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

// B-202: same 5-minute staleness budget as apps/worker/src/monitoring/queue-health.ts
// (docs/performance.md: "Queue depth ... alerts on > 5 min staleness").
const QUEUE_STALENESS_THRESHOLD_SECONDS = 5 * 60;

export interface QueueHealthStatus {
  queueName: string;
  queueLength: number;
  oldestMsgAgeSeconds: number | null;
  healthy: boolean;
}

export interface ImportFailureStatus {
  source: string;
  failedRunCount: number;
  mostRecentFailureAt: string | null;
}

export interface SystemHealth {
  queues: QueueHealthStatus[];
  importFailures: ImportFailureStatus[];
}

interface QueueMetricsRow {
  queue_name: string;
  queue_length: number;
  oldest_msg_age_sec: number | null;
}

interface ImportFailureRow {
  source: string;
  failed_run_count: number;
  most_recent_failure_at: string | null;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const supabase = createServerSupabaseClient();

  const [queueResult, importResult] = await Promise.all([
    supabase.rpc("get_queue_health_metrics"),
    supabase.rpc("get_import_failure_summary"),
  ]);

  if (queueResult.error) {
    logger.error("Fetch queue health metrics failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(queueResult.error),
    });
    throw new Error("Failed to fetch queue health metrics");
  }

  if (importResult.error) {
    logger.error("Fetch import failure summary failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(importResult.error),
    });
    throw new Error("Failed to fetch import failure summary");
  }

  const queues: QueueHealthStatus[] = ((queueResult.data ?? []) as QueueMetricsRow[]).map((row) => ({
    queueName: row.queue_name,
    queueLength: row.queue_length,
    oldestMsgAgeSeconds: row.oldest_msg_age_sec,
    healthy:
      row.oldest_msg_age_sec === null || row.oldest_msg_age_sec <= QUEUE_STALENESS_THRESHOLD_SECONDS,
  }));

  const importFailures: ImportFailureStatus[] = ((importResult.data ?? []) as ImportFailureRow[]).map(
    (row) => ({
      source: row.source,
      failedRunCount: row.failed_run_count,
      mostRecentFailureAt: row.most_recent_failure_at,
    }),
  );

  return { queues, importFailures };
}
