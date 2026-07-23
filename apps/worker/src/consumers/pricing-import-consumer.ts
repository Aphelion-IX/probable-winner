import type { Sql } from "postgres";

import { importMtgJsonPrices } from "../jobs/import-prices.js";
import { importExchangeRates } from "../jobs/import-exchange-rates.js";

const QUEUE_NAME = "pricing_import";
const VISIBILITY_TIMEOUT_SECONDS = 300;

type QueueMessage = {
  msg_id: number;
  message: { task?: "mtgjson_prices" | "exchange_rates" };
};

// Same read -> execute -> archive flow as stock-reconciliation-consumer.ts.
// Messages are enqueued by pg_cron (migration
// 20260723073400_schedule_price_import.sql for card prices,
// 20260723081930_schedule_exchange_rate_import.sql for exchange rates)
// rather than by a row-level trigger, since neither is a reaction to a
// domain event -- both are scheduled pulls from an external provider. One
// queue with a `task` discriminator rather than two queues: exchange
// rates and card prices are the same kind of work (pricing_import) at
// very different message volumes, not different domains. A missing task
// defaults to the original card-price behaviour so the pre-existing daily
// cron message (a bare '{}') keeps working unchanged. The visibility
// timeout is longer than the other consumers' because AllPricesToday is a
// large download-and-map pass, not a single-row operation.
export async function pollPricingImportQueue(sql: Sql): Promise<boolean> {
  const [msg] = await sql<QueueMessage[]>`
    select * from pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT_SECONDS}, 1)
  `;

  if (!msg) {
    return false;
  }

  const task = msg.message.task ?? "mtgjson_prices";

  try {
    if (task === "exchange_rates") {
      const result = await importExchangeRates(sql);
      console.log(`pricing_import (exchange_rates): stored ${result.ratesStored} rate(s)`);
    } else {
      const result = await importMtgJsonPrices(sql);
      console.log(
        `pricing_import run ${result.runId}: ${result.status}, ${result.mappedRowCount} mapped, ${result.unmappedRowCount} unmapped`,
      );
    }
  } catch (error) {
    // Left in the queue: pgmq's visibility timeout will make it re-readable
    // for a natural retry, per the failure behaviour in blueprint §17.
    console.error(`pricing_import (${task}) failed, will retry after visibility timeout:`, error);
    return true;
  }

  await sql`select pgmq.archive(${QUEUE_NAME}, ${msg.msg_id}::bigint)`;
  return true;
}
