import { createServerSupabaseClient } from "@/server/supabase";
import type { ParsedDecklistLine } from "@/features/deck-builder/lib/parse-decklist";

// Batched matching (backlog B-181): a 100-line list must resolve with a
// flat, small number of database round-trips, never one query per line
// (blueprint §20's explicit "one database request per search result"
// prohibition applies equally here). The only query this module issues is
// a single `card_browse.name IN (...)` lookup covering every distinct name
// across the whole list; everything else — narrowing by set code/collector
// number, grouping candidates per line — happens in memory afterwards.

export type DecklistMatchCandidate = {
  printingId: string;
  oracleCardId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
};

export type DecklistLineMatch = {
  line: ParsedDecklistLine;
  candidates: DecklistMatchCandidate[];
};

type CardBrowseRow = {
  printing_id: string;
  oracle_card_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
};

export function uniqueNames(lines: ParsedDecklistLine[]): string[] {
  return Array.from(new Set(lines.map((line) => line.name)));
}

export function buildNameLookup(
  candidates: DecklistMatchCandidate[],
): Map<string, DecklistMatchCandidate[]> {
  const lookup = new Map<string, DecklistMatchCandidate[]>();

  for (const candidate of candidates) {
    const existing = lookup.get(candidate.name);
    if (existing) {
      existing.push(candidate);
    } else {
      lookup.set(candidate.name, [candidate]);
    }
  }

  return lookup;
}

export function resolveLineCandidates(
  line: ParsedDecklistLine,
  lookup: Map<string, DecklistMatchCandidate[]>,
): DecklistMatchCandidate[] {
  let candidates = lookup.get(line.name) ?? [];

  // Compared case-insensitively: the parser always uppercases set codes,
  // but card_browse.set_code's casing depends on how the catalogue importer
  // stored it (MTGJSON codes aren't consistently cased), and collector
  // number suffixes ('125a' vs '125A') vary the same way.
  if (line.setCode) {
    const setCode = line.setCode.toLowerCase();
    candidates = candidates.filter((candidate) => candidate.setCode.toLowerCase() === setCode);
  }

  if (line.collectorNumber) {
    const collectorNumber = line.collectorNumber.toLowerCase();
    candidates = candidates.filter(
      (candidate) => candidate.collectorNumber.toLowerCase() === collectorNumber,
    );
  }

  return candidates;
}

export function matchLinesAgainstCandidates(
  lines: ParsedDecklistLine[],
  candidates: DecklistMatchCandidate[],
): DecklistLineMatch[] {
  const lookup = buildNameLookup(candidates);
  return lines.map((line) => ({ line, candidates: resolveLineCandidates(line, lookup) }));
}

export async function matchDecklistLines(
  lines: ParsedDecklistLine[],
): Promise<DecklistLineMatch[]> {
  if (lines.length === 0) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("card_browse")
    .select("printing_id, oracle_card_id, name, set_code, set_name, collector_number")
    .in("name", uniqueNames(lines))
    .returns<CardBrowseRow[]>();

  if (error) {
    throw new Error(`Failed to match decklist lines: ${error.message}`);
  }

  const candidates: DecklistMatchCandidate[] = (data ?? []).map((row) => ({
    printingId: row.printing_id,
    oracleCardId: row.oracle_card_id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
  }));

  return matchLinesAgainstCandidates(lines, candidates);
}
