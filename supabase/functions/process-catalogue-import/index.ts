import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const MTGJSON_BASE_URL = "https://mtgjson.com/api/v5";
const BATCH_SIZE = 10;

async function fetchSet(setCode: string) {
  const response = await fetch(`${MTGJSON_BASE_URL}/${setCode.toUpperCase()}.json`);
  if (!response.ok) {
    throw new Error(`MTGJSON request failed: ${response.status}`);
  }
  const body = await response.json();
  return body.data;
}

async function processQueue(req: Request) {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DATABASE_URL");

  if (!dbUrl) {
    return new Response("Missing SUPABASE_DB_URL", { status: 500 });
  }

  const client = new Client(dbUrl);

  try {
    await client.connect();
    let processed = 0;
    let failed = 0;
    const errors: Array<{ setCode: string; message: string }> = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      try {
        // Read one message from queue
        const result = await client.queryObject(
          `select * from pgmq.read('catalogue_import', 60, 1)`
        );

        if (!result.rows || result.rows.length === 0) {
          break;
        }

        const msg = result.rows[0] as any;
        const msgId = msg.msg_id;
        const setCode = msg.message?.setCode;

        if (!setCode) {
          // Invalid message, archive it
          await client.queryObject(`select pgmq.archive('catalogue_import', $1::bigint)`, [msgId]);
          continue;
        }

        try {
          // Fetch from MTGJSON — the response wraps the actual set under `data`
          const setData = await fetchSet(setCode);

          // Call the catalogue import stored procedure. It returns a status
          // object rather than raising, so failures don't roll back their
          // own bookkeeping (see catalogue_import_transaction_fix migration).
          const importResult = await client.queryObject(
            `select import_set_and_promote($1, $2::jsonb) as result`,
            [setCode, JSON.stringify(setData)]
          );

          const outcome = (importResult.rows[0] as any)?.result;

          if (outcome?.status === "succeeded") {
            await client.queryObject(`select pgmq.archive('catalogue_import', $1::bigint)`, [msgId]);
            processed++;
          } else {
            failed++;
            errors.push({ setCode, message: outcome?.error ?? "unknown failure" });
            // Leave message in queue for retry (visibility timeout handles it)
          }
        } catch (error) {
          failed++;
          errors.push({ setCode, message: String(error?.message ?? error) });
        }
      } catch (error) {
        errors.push({ setCode: "unknown", message: `Queue read error: ${String(error?.message ?? error)}` });
        break;
      }
    }

    await client.end();

    return new Response(
      JSON.stringify({
        processed,
        failed,
        errors,
        status: "ok",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error?.message ?? error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

Deno.serve(processQueue);
