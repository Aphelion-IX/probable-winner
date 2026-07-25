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
  // null when this local set's code matched a Scryfall set that an earlier
  // local set already claimed (see matchSetsByCode) -- scryfall_id is
  // unique, so only the first claimant can write it; every match still
  // gets the icon.
  scryfallId: string | null;
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
//
// More than one local set can share a code (e.g. a demo/perf-seed set
// reusing a real Scryfall code for its sample data) -- scryfall_id is
// unique, so only the first local set to match a given Scryfall entry
// claims it; later duplicates still get the icon, just not scryfall_id.
export function matchSetsByCode(
  localSets: LocalSet[],
  scryfallSets: ScryfallSet[],
): SetSymbolUpdate[] {
  const byCode = new Map(scryfallSets.map((set) => [set.code.toLowerCase(), set]));
  const claimedScryfallIds = new Set<string>();

  const updates: SetSymbolUpdate[] = [];
  for (const local of localSets) {
    const match = byCode.get(local.code.toLowerCase());
    if (!match?.icon_svg_uri) continue;

    const alreadyClaimed = claimedScryfallIds.has(match.id);
    claimedScryfallIds.add(match.id);
    updates.push({
      id: local.id,
      scryfallId: alreadyClaimed ? null : match.id,
      iconUrl: match.icon_svg_uri,
    });
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
//
// Two bulk statements (one per set of columns touched) rather than one
// UPDATE per row -- a full catalogue of sets is only a few hundred rows,
// but there's no reason to pay one round trip per row when postgres.js's
// `sql(rows)` builds a multi-row VALUES list directly.
export async function importSetSymbols(sql: Sql): Promise<ImportSetSymbolsResult> {
  const [localSets, scryfallSets] = await Promise.all([loadLocalSets(sql), fetchAllSets()]);
  const updates = matchSetsByCode(localSets, scryfallSets);

  const withScryfallId = updates.filter(
    (update): update is SetSymbolUpdate & { scryfallId: string } => update.scryfallId !== null,
  );
  const iconOnly = updates.filter((update) => update.scryfallId === null);

  if (withScryfallId.length > 0) {
    await sql`
      update sets set
        scryfall_id = (u.scryfall_id)::uuid,
        icon_url = u.icon_url,
        updated_at = now()
      from (values ${sql(withScryfallId.map((u) => [u.id, u.scryfallId, u.iconUrl]))})
        as u(id, scryfall_id, icon_url)
      where sets.id = (u.id)::uuid
    `;
  }

  if (iconOnly.length > 0) {
    await sql`
      update sets set
        icon_url = u.icon_url,
        updated_at = now()
      from (values ${sql(iconOnly.map((u) => [u.id, u.iconUrl]))})
        as u(id, icon_url)
      where sets.id = (u.id)::uuid
    `;
  }

  return {
    setsProcessed: localSets.length,
    iconsUpserted: updates.length,
    unmatched: localSets.length - updates.length,
  };
}
