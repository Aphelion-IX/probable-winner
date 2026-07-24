import type { sql as SqlClient } from "../db.js";

export interface DbHealthSnapshot {
  cacheHitRate: number;
  queueDelaySec: Record<string, number>;
  slowestStatements: Array<{ query: string; meanExecMs: number; calls: number }>;
}

/**
 * Snapshots the metrics blueprint §23 asks every load-test scenario to
 * track that aren't visible from the application side: cache hit rate
 * (pg_statio), queue backlog age (pgmq, via the same metrics_all() the
 * B-202 staff monitoring page reads), and the slowest statements seen
 * since the last pg_stat_statements reset. Database CPU isn't queryable
 * from SQL on this managed Postgres — cross-reference the Supabase
 * dashboard/API for that metric during a real run.
 */
export async function snapshotDbHealth(sql: typeof SqlClient): Promise<DbHealthSnapshot> {
  const [cacheRow] = await sql<[{ hit_rate: number }]>`
    select
      case when sum(blks_hit + blks_read) = 0 then 1
        else sum(blks_hit)::float / sum(blks_hit + blks_read)
      end as hit_rate
    from pg_stat_database
    where datname = current_database()
  `;

  const queueRows = await sql<Array<{ queue_name: string; oldest_msg_age_sec: number | null }>>`
    select queue_name, oldest_msg_age_sec from pgmq.metrics_all()
  `;

  const slowRows = await sql<Array<{ query: string; mean_exec_time: number; calls: number }>>`
    select query, mean_exec_time, calls
    from pg_stat_statements
    where query not ilike '%pg_stat_statements%'
    order by mean_exec_time desc
    limit 10
  `;

  return {
    cacheHitRate: cacheRow?.hit_rate ?? 1,
    queueDelaySec: Object.fromEntries(
      queueRows.map((r) => [r.queue_name, r.oldest_msg_age_sec ?? 0]),
    ),
    slowestStatements: slowRows.map((r) => ({
      query: r.query.slice(0, 120),
      meanExecMs: r.mean_exec_time,
      calls: r.calls,
    })),
  };
}
