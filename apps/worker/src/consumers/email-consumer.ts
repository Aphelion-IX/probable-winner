import type { Sql } from "postgres";

import { createEmailProviderFromEnv } from "../integrations/email/resend-provider.js";
import { sendOrderConfirmationEmail } from "../jobs/send-order-confirmation-email.js";
import { logger } from "../logger.js";

const QUEUE_NAME = "email";
const VISIBILITY_TIMEOUT_SECONDS = 30;

type EmailQueueMessage = {
  msg_id: number;
  message: { emailType?: string; orderId?: string };
};

// Consumer half of the "email" pgmq queue outbox: currently drains only
// the order_confirmation messages emit_integration_event() sends for an
// 'order_paid' event (confirm_order_payment(), migration
// 20260727060000_order_confirmation_email.sql). A new email type is added
// here as its own branch, not by overloading this one, when the next
// producer for this queue exists.
export async function pollEmailQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<EmailQueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  const { emailType, orderId } = msg.message;

  if (emailType !== "order_confirmation" || !orderId) {
    logger.error("email message has an unrecognised shape — archiving without retry", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      emailType,
    });
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const emailProvider = createEmailProviderFromEnv();
    const sent = await sendOrderConfirmationEmail(sql, emailProvider, orderId);

    logger.info("email message processed", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      emailType,
      orderId,
      sent,
    });
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, same failure behaviour as the other consumers.
    logger.error("email processing failed, will retry after visibility timeout", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      error: logger.serializeError(error),
    });
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
