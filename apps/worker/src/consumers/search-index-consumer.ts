import type { Sql } from "postgres";

import { updateSearchDocument } from "../jobs/update-search-document.js";
import { logger } from "../logger.js";

const QUEUE_NAME = "search_index";
const VISIBILITY_TIMEOUT_SECONDS = 30;

type QueueMessage = {
  msg_id: number;
  message: { integrationEventId?: string; eventType?: string };
};

type IntegrationEventRow = {
  id: string;
  event_type: string;
  aggregate_type: string;
  payload: Record<string, unknown>;
};

// Every atomic function that touches inventory or publishes/overrides a
// price writes to integration_events and enqueues a search_index message in
// the same transaction (emit_integration_event(), migration
// 20260723065043 / 20260724190000). This is the consumer half of that
// outbox (backlog B-083, blueprint §13.3): read one message, resolve the
// affected SKU, and rebuild just that one Typesense document — never a
// full reindex per change.
export function extractSkuId(payload: Record<string, unknown>): string | null {
  const value = payload.sellableSkuId;
  return typeof value === "string" ? value : null;
}

export async function pollSearchIndexQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  const integrationEventId = msg.message.integrationEventId;
  if (!integrationEventId) {
    logger.error("search_index message missing integrationEventId — archiving without retry", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
    });
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const [event] = await sql<IntegrationEventRow[]>`
      select id, event_type, aggregate_type, payload
      from integration_events
      where id = ${integrationEventId}::uuid
    `;

    if (!event) {
      logger.error("search_index message references an unknown integration_event — archiving", {
        queue: QUEUE_NAME,
        msgId: msg.msg_id,
        integrationEventId,
      });
      await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
      return true;
    }

    const skuId = extractSkuId(event.payload);
    if (skuId) {
      await updateSearchDocument(sql, skuId);
    }

    logger.info("search_index message processed", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      eventType: event.event_type,
      skuId,
    });
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, same failure behaviour as the other consumers.
    logger.error("search_index processing failed, will retry after visibility timeout", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      error: logger.serializeError(error),
    });
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
