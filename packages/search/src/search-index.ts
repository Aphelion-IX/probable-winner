import MiniSearch from "minisearch";

import type { CardSearchDocument } from "./card-search-document";

// Fields MiniSearch tokenizes for full-text relevance ranking.
const INDEXED_FIELDS: (keyof CardSearchDocument)[] = ["name", "type_line", "artist", "set_name"];

// Every field a filter, sort, or rendered search hit needs. MiniSearch has
// no separate document store of its own -- a search result only carries
// whatever was configured here, so this is effectively every field on
// CardSearchDocument except id (which MiniSearch already tracks via
// idField).
const STORED_FIELDS: (keyof CardSearchDocument)[] = [
  "printing_id",
  "oracle_id",
  "name",
  "set_code",
  "set_name",
  "collector_number",
  "rarity",
  "artist",
  "image_url",
  "colour_identity",
  "colour_count",
  "mana_cost",
  "cmc",
  "type_line",
  "finish",
  "condition",
  "language",
  "layout",
  "legality",
  "price_amount",
  "price_currency",
  "quantity_available",
  "quantity_in_stores",
  "popularity_score",
  "last_updated_at",
  "catalogued_at",
];

// The worker keeps this in process memory as the live search index (see
// apps/worker/src/search/index-store.ts) -- unlike Typesense, MiniSearch is
// a library, not a service, so *something* has to hold this state, and a
// long-running worker process is that something. `docsById` is this
// module's own source of truth (MiniSearch has no "get document by id"
// outside of a search match), used for persistence and for patching a
// single field (e.g. popularity_score) without needing every other field
// supplied by the caller.
export interface SearchIndex {
  mini: MiniSearch<CardSearchDocument>;
  docsById: Map<string, CardSearchDocument>;
}

function newMiniSearch(): MiniSearch<CardSearchDocument> {
  return new MiniSearch<CardSearchDocument>({
    idField: "id",
    fields: INDEXED_FIELDS,
    storeFields: STORED_FIELDS,
  });
}

export function createEmptySearchIndex(): SearchIndex {
  return { mini: newMiniSearch(), docsById: new Map() };
}

export function buildSearchIndex(documents: readonly CardSearchDocument[]): SearchIndex {
  const mini = newMiniSearch();
  mini.addAll(documents);

  const docsById = new Map(documents.map((doc) => [doc.id, doc]));
  return { mini, docsById };
}

// Adds a new document or replaces an existing one (matched by id). Never a
// full reindex per change -- this is the piece that keeps search fresh
// without the "recalculate everything per request" pattern blueprint §20
// prohibits.
export function upsertDocument(index: SearchIndex, doc: CardSearchDocument): void {
  if (index.mini.has(doc.id)) {
    index.mini.replace(doc);
  } else {
    index.mini.add(doc);
  }
  index.docsById.set(doc.id, doc);
}

export function removeDocument(index: SearchIndex, id: string): void {
  if (index.mini.has(id)) {
    index.mini.discard(id);
  }
  index.docsById.delete(id);
}

// Patches one or more fields on an existing document (e.g. popularity_score)
// without the caller needing to supply every other field -- MiniSearch's
// own replace() requires the complete document, so this reads the current
// one from docsById, merges, and replaces. Returns false if there is no
// existing document for this id (nothing to patch).
export function patchDocument(
  index: SearchIndex,
  id: string,
  patch: Partial<CardSearchDocument>,
): boolean {
  const current = index.docsById.get(id);
  if (!current) return false;

  upsertDocument(index, { ...current, ...patch });
  return true;
}

// Serializes to the raw document list, not MiniSearch's own toJSON format --
// rebuilding a fresh index from documents (buildSearchIndex) is already
// required for the full-reindex path, so reusing it for "load a persisted
// snapshot" too means there is exactly one code path that turns documents
// into an index, rather than two that could drift apart.
export function serializeSearchIndex(index: SearchIndex): string {
  return JSON.stringify(Array.from(index.docsById.values()));
}

export function deserializeSearchIndex(json: string): SearchIndex {
  const documents = JSON.parse(json) as CardSearchDocument[];
  return buildSearchIndex(documents);
}
