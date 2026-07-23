import type { Sql } from "postgres";

import { importMtgJsonPrices } from "../jobs/import-prices.js";

const QUEUE_NAME = "pricing_import";
const VISIBILITY_TIMEOUT_SECONDS = 300;

type QueueMessage = {
  msg_id: number;
  message: Record<string, never>;
};

// Same read -> execute -> archive flow as stock-reconciliation-consumer.ts.
// Messages are enqueued daily by pg_cron (migration
// 20260723073400_schedule_price_import.sql) rather than by a row-level
// trigger, since a price import isn't a reaction to a domain event -- it's
// a scheduled pull from an external provider. The visibility timeout is
// longer than the other consumers' because AllPricesToday is a large
// download-and-map pass, not a single-row operation.
export async function pollPricingImportQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  try {
    const result = await importMtgJsonPrices(sql);
    console.log(
      `pricing_import run ${result.runId}: ${result.status}, ${result.mappedRowCount} mapped, ${result.unmappedRowCount} unmapped`,
    );
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, per the failure behaviour in blueprint §17.
    console.error("pricing_import failed, will retry after visibility timeout:", error);
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
