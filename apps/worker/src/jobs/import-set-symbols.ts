import type { Sql } from "postgres";

import { fetchAllSets } from "../integrations/scryfall/client.js";
import type { ScryfallSet } from "../integrations/scryfall/types.js";

const GAME_CODE = "mtg";

export type LocalSet = {
  id: string;
  code: string;
};

export type SetSymbolUpdate = {
  id: string;
  scryfallId: string;
  iconUrl: string;
};

export type ImportSetSymbolsResult = {
  setsProcessed: number;
  iconsUpserted: number;
  unmatched: number;
};

// Pure code-matching, kept separate from the DB/network IO below so it's
// unit-testable without a live database or API call. Matched
// case-insensitively: Scryfall's own codes are lowercase by convention and
// so is this catalogue's (mapCard/mapSet upper/lowercases consistently),
// but there's no reason to let a casing mismatch silently drop a match.
// A Scryfall entry with no icon_svg_uri (rare) is skipped rather than
// upserting a null icon_url over a possibly-already-populated one on a
// re-run.
export function matchSetsByCode(
  localSets: LocalSet[],
  scryfallSets: ScryfallSet[],
): SetSymbolUpdate[] {
  const byCode = new Map(scryfallSets.map((set) => [set.code.toLowerCase(), set]));

  const updates: SetSymbolUpdate[] = [];
  for (const local of localSets) {
    const match = byCode.get(local.code.toLowerCase());
    if (match?.icon_svg_uri) {
      updates.push({ id: local.id, scryfallId: match.id, iconUrl: match.icon_svg_uri });
    }
  }

  return updates;
}

async function loadLocalSets(sql: Sql): Promise<LocalSet[]> {
  return sql<LocalSet[]>`
    select s.id, s.code
    from sets s
    join games g on g.id = s.game_id
    where g.code = ${GAME_CODE}
  `;
}

// Backfills sets.scryfall_id/icon_url (both already existed on the schema,
// unpopulated) from Scryfall's set-symbol data. Never creates a set --
// discovering new sets stays the MTGJSON importer's job; this only
// enriches sets that already exist. Safe to re-run: each run recomputes
// the same values for any matched code.
export async function importSetSymbols(sql: Sql): Promise<ImportSetSymbolsResult> {
  const [localSets, scryfallSets] = await Promise.all([loadLocalSets(sql), fetchAllSets()]);
  const updates = matchSetsByCode(localSets, scryfallSets);

  for (const update of updates) {
    await sql`
      update sets
      set scryfall_id = ${update.scryfallId}, icon_url = ${update.iconUrl}, updated_at = now()
      where id = ${update.id}
    `;
  }

  return {
    setsProcessed: localSets.length,
    iconsUpserted: updates.length,
    unmatched: localSets.length - updates.length,
  };
}
