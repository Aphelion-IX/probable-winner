import type { Sql } from "postgres";

import { reconcileStocktake } from "../jobs/reconcile-stocktake.js";

const QUEUE_NAME = "stock_reconciliation";
const VISIBILITY_TIMEOUT_SECONDS = 60;

type QueueMessage = {
  msg_id: number;
  message: { stocktakeId?: string };
};

// Same read -> validate -> execute -> archive flow as
// catalogue-import-consumer.ts. Messages are enqueued by the
// enqueue_stock_reconciliation() trigger (migration 20260723063559) when a
// stocktake's status flips to 'completed'.
export async function pollStockReconciliationQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  const stocktakeId = msg.message.stocktakeId;
  if (!stocktakeId) {
    console.error(
      `stock_reconciliation message ${msg.msg_id} is missing "stocktakeId" — archiving without retry`,
    );
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const result = await reconcileStocktake(sql, stocktakeId);
    console.log(
      `stock_reconciliation ${stocktakeId}: reconciled ${result.linesReconciled} lines, wrote ${result.adjustmentsWritten} adjustments`,
    );
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, per the failure behaviour in blueprint §17.
    console.error(`stock_reconciliation ${stocktakeId} failed, will retry after visibility timeout:`, error);
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
