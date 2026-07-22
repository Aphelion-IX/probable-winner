import type { Sql } from "postgres";

import { importSet } from "../jobs/catalogue-import.js";

const QUEUE_NAME = "catalogue_import";
const VISIBILITY_TIMEOUT_SECONDS = 60;

type QueueMessage = {
  msg_id: number;
  message: { setCode?: string };
};

// Read queue message -> validate payload -> execute job -> archive message,
// per the worker flow in blueprint §17. Returns whether a message was
// available, so the caller's poll loop knows whether to back off.
export async function pollCatalogueImportQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  const setCode = msg.message.setCode;
  if (!setCode) {
    console.error(
      `catalogue_import message ${msg.msg_id} is missing "setCode" — archiving without retry`,
    );
    await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
    return true;
  }

  try {
    const result = await importSet(sql, setCode);
    console.log(`catalogue_import ${setCode}: ${result.status} (${result.cardsProcessed} cards)`);
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, per the failure behaviour in blueprint §17.
    console.error(
      `catalogue_import ${setCode} failed, will retry after visibility timeout:`,
      error,
    );
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
