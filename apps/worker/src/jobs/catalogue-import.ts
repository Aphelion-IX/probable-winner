import type { Sql } from "postgres";

import { fetchSet, MtgJsonValidationError } from "../integrations/mtgjson/client.js";
import type { MtgJsonCard, MtgJsonSet } from "../integrations/mtgjson/types.js";

const GAME_CODE = "mtg";
const SOURCE = "mtgjson";

export type ImportSetResult = {
  runId: string;
  status: "succeeded" | "failed";
  setsProcessed: number;
  cardsProcessed: number;
};

export type StagingRows = {
  setRow: { externalId: string; raw: Omit<MtgJsonSet, "cards"> };
  cardRows: { externalId: string; raw: MtgJsonCard }[];
};

// Pure mapping, kept separate from the DB IO below so it's unit-testable
// against a real MTGJSON fixture without a live database (backlog B-040's
// "staging rows match fixture counts" AC).
export function toStagingRows(set: MtgJsonSet): StagingRows {
  const { cards, ...setMeta } = set;
  return {
    setRow: { externalId: set.code, raw: setMeta },
    cardRows: cards.map((card) => ({ externalId: card.uuid, raw: card })),
  };
}

// Resumable per backlog B-040: the run is keyed by (game, source, "set:CODE")
// and staging inserts are keyed by the provider's own id, both with
// ON CONFLICT DO NOTHING/idempotent upsert — re-running after a crash skips
// whatever was already staged instead of downloading and inserting again.
export async function importSet(sql: Sql, setCode: string): Promise<ImportSetResult> {
  const sourceRef = `set:${setCode.toUpperCase()}`;

  const [game] = await sql<{ id: string }[]>`
    select id from games where code = ${GAME_CODE}
  `;
  if (!game) {
    throw new Error(`Game "${GAME_CODE}" is not seeded — run the catalogue migrations first`);
  }

  const [run] = await sql<{ id: string; status: string }[]>`
    insert into catalogue_import_runs (game_id, source, source_ref)
    values (${game.id}, ${SOURCE}, ${sourceRef})
    on conflict (game_id, source, source_ref) do update set source_ref = excluded.source_ref
    returning id, status
  `;

  if (run.status === "succeeded") {
    return { runId: run.id, status: "succeeded", setsProcessed: 0, cardsProcessed: 0 };
  }

  try {
    const set = await fetchSet(setCode);
    const { setRow, cardRows } = toStagingRows(set);

    await sql`
      insert into catalogue_staging_sets (catalogue_import_run_id, external_id, raw)
      values (${run.id}, ${setRow.externalId}, ${sql.json(setRow.raw)})
      on conflict (catalogue_import_run_id, external_id) do nothing
    `;

    if (cardRows.length > 0) {
      const rows = cardRows.map((row) => ({
        catalogue_import_run_id: run.id,
        external_id: row.externalId,
        raw: sql.json(row.raw),
      }));

      await sql`
        insert into catalogue_staging_cards ${sql(rows, "catalogue_import_run_id", "external_id", "raw")}
        on conflict (catalogue_import_run_id, external_id) do nothing
      `;
    }

    await sql`
      update catalogue_import_runs
      set status = 'succeeded', completed_at = now(), sets_processed = 1, cards_processed = ${cardRows.length}
      where id = ${run.id}
    `;

    return {
      runId: run.id,
      status: "succeeded",
      setsProcessed: 1,
      cardsProcessed: cardRows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await sql`
      insert into catalogue_import_errors (catalogue_import_run_id, severity, message, context)
      values (${run.id}, 'error', ${message}, ${sql.json({ setCode })})
    `;
    await sql`
      update catalogue_import_runs set status = 'failed', completed_at = now() where id = ${run.id}
    `;

    if (error instanceof MtgJsonValidationError) {
      return { runId: run.id, status: "failed", setsProcessed: 0, cardsProcessed: 0 };
    }

    throw error;
  }
}
