import type { Sql } from "postgres";

import { importSet } from "../jobs/catalogue-import.js";
import { discoverAndEnqueueSets } from "../jobs/discover-catalogue-sets.js";
import { generateSkusForPrintings } from "../jobs/generate-skus.js";
import { promoteRun } from "../jobs/promote-catalogue.js";
import { logger } from "../logger.js";

const QUEUE_NAME = "catalogue_import";
const VISIBILITY_TIMEOUT_SECONDS = 60;

type QueueMessage = {
  msg_id: number;
  message: { setCode?: string; discover?: boolean };
};

// Read queue message -> validate payload -> execute job -> archive message,
// per the worker flow in blueprint §17. Returns whether a message was
// available, so the caller's poll loop knows whether to back off. A
// {"discover": true} message (sent by the weekly cron in migration
// 20260724000500_schedule_catalogue_discovery.sql, or the
// enqueue-catalogue-import script) is handled separately from a per-set
// {"setCode": ...} message: it expands into one setCode message per
// not-yet-imported MTGJSON set rather than importing a set itself.
export async function pollCatalogueImportQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  if (msg.message.discover) {
    try {
      const result = await discoverAndEnqueueSets(sql);
      console.log(
        `catalogue_import discover: enqueued ${result.enqueued} of ${result.totalSets} sets (${result.alreadyImported} already imported)`,
      );
    } catch (error) {
      console.error(
        "catalogue_import discover failed, will retry after visibility timeout:",
        error,
      );
      return true;
    }
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  const setCode = msg.message.setCode;
  if (!setCode) {
    logger.error("catalogue_import message missing setCode — archiving without retry", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
    });
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const result = await importSet(sql, setCode);
    logger.info("catalogue_import set processed", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      setCode,
      status: result.status,
      cardsProcessed: result.cardsProcessed,
    });

    if (result.status === "succeeded") {
      const promoted = await promoteRun(sql, result.runId);
      logger.info("catalogue_import run promoted", {
        queue: QUEUE_NAME,
        msgId: msg.msg_id,
        setCode,
        oracleCardsUpserted: promoted.oracleCardsUpserted,
        printingsUpserted: promoted.printingsUpserted,
      });

      const skus = await generateSkusForPrintings(sql, promoted.printingIds);
      logger.info("catalogue_import SKUs generated", {
        queue: QUEUE_NAME,
        msgId: msg.msg_id,
        setCode,
        skusInserted: skus.skusInserted,
      });
    }
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, per the failure behaviour in blueprint §17.
    logger.error("catalogue_import failed, will retry after visibility timeout", {
      queue: QUEUE_NAME,
      msgId: msg.msg_id,
      setCode,
      error: logger.serializeError(error),
    });
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
