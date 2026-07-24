import type { Sql } from "postgres";

import { reconcileStocktake } from "../jobs/reconcile-stocktake.js";
import { logger } from "../logger.js";

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
    logger.error("stock_reconciliation message missing stocktakeId — archiving without retry", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
    });
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const result = await reconcileStocktake(sql, stocktakeId);
    logger.info("stock_reconciliation completed", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      stocktakeId,
      linesReconciled: result.linesReconciled,
      adjustmentsWritten: result.adjustmentsWritten,
    });
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, per the failure behaviour in blueprint §17.
    logger.error("stock_reconciliation failed, will retry after visibility timeout", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      stocktakeId,
      error: logger.serializeError(error),
    });
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
