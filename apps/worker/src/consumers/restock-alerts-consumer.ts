import type { Sql } from "postgres";

import { createEmailProviderFromEnv } from "../integrations/email/resend-provider.js";
import {
  processPriceAlertCheck,
  processRestockAlertCheck,
} from "../jobs/notify-alert-subscribers.js";
import { logger } from "../logger.js";

const QUEUE_NAME = "restock_alerts";
const VISIBILITY_TIMEOUT_SECONDS = 30;

type AlertCheckMessage = {
  checkType?: "restock" | "price";
  sellableSkuId?: string;
  finalAmount?: number;
  currency?: string;
};

type QueueMessage = {
  msg_id: number;
  message: AlertCheckMessage;
};

// Consumer half of the restock/price alert outbox (backlog B-192): reads
// one message enqueued by emit_integration_event() (inventory changes) or
// publish_suggested_price() (price changes), finds any matching active
// alert, and emails the subscriber. Each matching alert is flipped to
// 'triggered' immediately after a successful send, so a retry after a
// partial failure (one bad email address in a batch, a transient provider
// error) only reprocesses what's left -- same idempotent-retry shape as
// reconcileStocktake.
export async function pollRestockAlertsQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  const { checkType, sellableSkuId, finalAmount, currency } = msg.message;

  if (!sellableSkuId) {
    logger.error("restock_alerts message missing sellableSkuId — archiving without retry", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
    });
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  if (checkType === "price" && (finalAmount == null || !currency)) {
    logger.error(
      "restock_alerts price-check message missing finalAmount/currency — archiving without retry",
      { queue: QUEUE_NAME, msgId: msg.msg_id },
    );
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const emailProvider = createEmailProviderFromEnv();
    const notified =
      checkType === "price"
        ? await processPriceAlertCheck(sql, emailProvider, sellableSkuId, finalAmount!, currency!)
        : await processRestockAlertCheck(sql, emailProvider, sellableSkuId);

    logger.info("restock_alerts message processed", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      checkType: checkType ?? "restock",
      sellableSkuId,
      notified,
    });
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, same failure behaviour as the other consumers.
    logger.error("restock_alerts processing failed, will retry after visibility timeout", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      error: logger.serializeError(error),
    });
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
