// Decklist parser (backlog Step 19 / B-180). Handles the common real-world
// list formats customers paste in: plain "quantity + name" lines, with or
// without a trailing set code (parens or brackets) and collector number,
// section headers/comments to skip, and bare card names with no quantity.
//
// This module only parses text into structured lines — it does not touch
// the catalogue or database (that's B-181's job, matching sellable SKUs in
// batched queries, not one per line).

export type ParsedDecklistLine = {
  raw: string;
  quantity: number;
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
};

export type ParseDecklistResult = {
  lines: ParsedDecklistLine[];
  skippedLines: string[];
};

const COMMENT_PREFIXES = ["//", "#"];

// Common section headers pasted alongside a main deck list. Matched
// case-insensitively against the whole line (with or without a trailing
// colon) so "Sideboard", "Sideboard:", and "SIDEBOARD" all skip cleanly.
const SECTION_HEADERS = new Set([
  "deck",
  "decklist",
  "mainboard",
  "main deck",
  "sideboard",
  "maybeboard",
  "commander",
]);

const QUANTITY_PREFIX = /^(\d+)\s*[xX]?\s+(.+)$/;
const TRAILING_PARENS_SET = /^(.+?)\s*\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-]+)?\s*$/;
const TRAILING_BRACKET_SET = /^(.+?)\s*\[([A-Za-z0-9]{2,6})\]\s*([A-Za-z0-9-]+)?\s*$/;

function isSectionHeader(line: string): boolean {
  const normalized = line.replace(/:$/, "").trim().toLowerCase();
  return SECTION_HEADERS.has(normalized);
}

function isComment(line: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function extractSetInfo(rest: string): {
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
} {
  const parensMatch = rest.match(TRAILING_PARENS_SET);
  if (parensMatch) {
    return {
      name: parensMatch[1].trim(),
      setCode: parensMatch[2].toUpperCase(),
      collectorNumber: parensMatch[3] ?? null,
    };
  }

  const bracketMatch = rest.match(TRAILING_BRACKET_SET);
  if (bracketMatch) {
    return {
      name: bracketMatch[1].trim(),
      setCode: bracketMatch[2].toUpperCase(),
      collectorNumber: bracketMatch[3] ?? null,
    };
  }

  return { name: rest.trim(), setCode: null, collectorNumber: null };
}

export function parseDecklistLine(rawLine: string): ParsedDecklistLine | null {
  const line = rawLine.trim();

  if (!line || isComment(line) || isSectionHeader(line)) {
    return null;
  }

  const quantityMatch = line.match(QUANTITY_PREFIX);
  const quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;
  const rest = quantityMatch ? quantityMatch[2] : line;

  const { name, setCode, collectorNumber } = extractSetInfo(rest);

  if (!name) {
    return null;
  }

  return { raw: rawLine, quantity, name, setCode, collectorNumber };
}

export function parseDecklist(input: string): ParseDecklistResult {
  const lines: ParsedDecklistLine[] = [];
  const skippedLines: string[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const parsed = parseDecklistLine(rawLine);
    if (parsed) {
      lines.push(parsed);
    } else if (rawLine.trim()) {
      skippedLines.push(rawLine.trim());
    }
  }

  return { lines, skippedLines };
}
