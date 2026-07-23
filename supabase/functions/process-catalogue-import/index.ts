import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const MTGJSON_BASE_URL = "https://mtgjson.com/api/v5";

async function fetchSet(setCode: string) {
  const response = await fetch(`${MTGJSON_BASE_URL}/${setCode.toUpperCase()}.json`);
  if (!response.ok) {
    throw new Error(`MTGJSON request failed: ${response.status}`);
  }
  return response.json();
}

async function processQueue(req: Request) {
  const dbUrl = Deno.env.get("DATABASE_URL");

  if (!dbUrl) {
    return new Response("Missing DATABASE_URL", { status: 500 });
  }

  const client = new Client(dbUrl);

  try {
    await client.connect();
    let processed = 0;
    let failed = 0;

    // Process up to 5 sets per invocation (keep it quick for Edge Functions)
    for (let i = 0; i < 5; i++) {
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
          await client.queryObject(`select pgmq.archive('catalogue_import', $1)`, [msgId]);
          continue;
        }

        console.log(`Processing: ${setCode}`);

        try {
          // Fetch from MTGJSON
          const setData = await fetchSet(setCode);

          // Call the catalogue import stored procedure
          await client.queryObject(
            `select import_set_and_promote($1, $2)`,
            [setCode, JSON.stringify(setData)]
          );

          // Archive message on success
          await client.queryObject(`select pgmq.archive('catalogue_import', $1)`, [msgId]);

          processed++;
          console.log(`✓ ${setCode}`);
        } catch (error) {
          failed++;
          console.error(`✗ ${setCode}: ${error.message}`);
          // Leave message in queue for retry (visibility timeout handles it)
        }
      } catch (error) {
        console.error("Queue read error:", error);
        break;
      }
    }

    await client.end();

    return new Response(
      JSON.stringify({
        processed,
        failed,
        status: "ok",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Connection error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

Deno.serve(processQueue);
