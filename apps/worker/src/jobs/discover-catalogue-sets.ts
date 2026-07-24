import type { Sql } from "postgres";

import { fetchSetList } from "../integrations/mtgjson/client.js";
import type { MtgJsonSetListEntry } from "../integrations/mtgjson/types.js";

const GAME_CODE = "mtg";
const SOURCE = "mtgjson";
const QUEUE_NAME = "catalogue_import";

export type DiscoverSetsResult = {
  totalSets: number;
  enqueued: number;
  alreadyImported: number;
};

// Pure filter, unit-testable without a live database: given the full
// MTGJSON SetList and the set codes catalogue_import_runs already recorded
// as succeeded, returns the codes still worth enqueuing. Not required for
// correctness (importSet() already no-ops on a succeeded run per B-040),
// but keeps the catalogue_import queue from being flooded with hundreds of
// already-done messages on every discovery run.
export function selectSetsToEnqueue(
  setList: MtgJsonSetListEntry[],
  alreadyImportedCodes: ReadonlySet<string>,
): string[] {
  return setList
    .map((set) => set.code.toUpperCase())
    .filter((code) => !alreadyImportedCodes.has(code));
}

// Enumerates every MTGJSON set and enqueues one catalogue_import message
// per set not already fully imported, so the whole catalogue -- not just a
// set code a caller already knows -- can actually be downloaded (backlog
// B-040). Triggered either by the enqueue-catalogue-import script (one-off
// backfill/refresh) or by the weekly discovery cron message (migration
// 20260724000500_schedule_catalogue_discovery.sql), which picks up newly
// released sets automatically.
export async function discoverAndEnqueueSets(sql: Sql): Promise<DiscoverSetsResult> {
  const setList = await fetchSetList();

  const [game] = await sql<{ id: string }[]>`
    select id from games where code = ${GAME_CODE}
  `;
  if (!game) {
    throw new Error(`Game "${GAME_CODE}" is not seeded — run the catalogue migrations first`);
  }

  const succeededRuns = await sql<{ source_ref: string }[]>`
    select source_ref from catalogue_import_runs
    where game_id = ${game.id} and source = ${SOURCE} and status = 'succeeded'
  `;
  const alreadyImportedCodes = new Set(
    succeededRuns
      .map((run) => run.source_ref.match(/^set:(.+)$/)?.[1])
      .filter((code): code is string => Boolean(code)),
  );

  const codesToEnqueue = selectSetsToEnqueue(setList, alreadyImportedCodes);

  for (const code of codesToEnqueue) {
    await sql`select pgmq.send(${QUEUE_NAME}, ${sql.json({ setCode: code })})`;
  }

  return {
    totalSets: setList.length,
    enqueued: codesToEnqueue.length,
    alreadyImported: setList.length - codesToEnqueue.length,
  };
}
