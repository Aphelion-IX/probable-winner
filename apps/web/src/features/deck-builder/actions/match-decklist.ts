"use server";

import { parseDecklist } from "@/features/deck-builder/lib/parse-decklist";
import { matchDecklistLines } from "@/features/deck-builder/queries/match-decklist-lines";

export type DecklistImportCandidate = {
  printingId: string;
  oracleCardId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
};

export type DecklistImportLine = {
  raw: string;
  quantity: number;
  name: string;
  candidates: DecklistImportCandidate[];
};

export type DecklistImportResult = {
  lines: DecklistImportLine[];
  skippedLines: string[];
};

export async function importDecklist(rawText: string): Promise<DecklistImportResult> {
  const { lines, skippedLines } = parseDecklist(rawText);
  const matches = await matchDecklistLines(lines);

  return {
    lines: matches.map(({ line, candidates }) => ({
      raw: line.raw,
      quantity: line.quantity,
      name: line.name,
      candidates,
    })),
    skippedLines,
  };
}
