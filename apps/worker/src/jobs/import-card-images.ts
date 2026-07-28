import type { Sql } from "postgres";

import {
  fetchCardsByScryfallIds,
  SCRYFALL_COLLECTION_BATCH_LIMIT,
} from "../integrations/scryfall/client.js";
import type { ScryfallCard, ScryfallLegalityStatus } from "../integrations/scryfall/types.js";

export type PendingPrinting = {
  cardPrintingId: string;
  oracleCardId: string;
  scryfallId: string;
};

export type CardImageRow = {
  cardPrintingId: string;
  imageType: "small" | "normal" | "large" | "png" | "art_crop" | "border_crop";
  face: "front" | "back";
  url: string;
};

export type CardLegalityRow = {
  oracleCardId: string;
  formatId: string;
  status: ScryfallLegalityStatus;
};

export type ImportCardImagesResult = {
  printingsProcessed: number;
  imagesUpserted: number;
  legalitiesUpserted: number;
  notFound: number;
};

const VALID_LEGALITY_STATUSES = new Set<string>([
  "legal",
  "not_legal",
  "restricted",
  "banned",
]);

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Pure card -> card_images row mapping, kept separate from the DB/network
// IO below so it's unit-testable against real Scryfall response shapes
// without a live database or API call. Single-faced cards carry one
// top-level image_uris (face "front"); double-faced/split/etc. cards carry
// per-face image_uris under card_faces instead (Scryfall's own
// documented distinction) -- only the first two faces are mapped to
// front/back, matching card_images' two-face schema (rare 3+-face layouts
// like meld are not represented).
export function buildImageRows(cardPrintingId: string, card: ScryfallCard): CardImageRow[] {
  const rows: CardImageRow[] = [];
  const IMAGE_TYPES = ["small", "normal", "large", "png", "art_crop", "border_crop"] as const;

  function pushFace(face: "front" | "back", imageUris: Record<string, string | undefined>) {
    for (const imageType of IMAGE_TYPES) {
      const url = imageUris[imageType];
      if (url) {
        rows.push({ cardPrintingId, imageType, face, url });
      }
    }
  }

  if (card.image_uris) {
    pushFace("front", card.image_uris);
  } else if (card.card_faces && card.card_faces.length > 0) {
    const [front, back] = card.card_faces;
    if (front?.image_uris) pushFace("front", front.image_uris);
    if (back?.image_uris) pushFace("back", back.image_uris);
  }

  return rows;
}

// Pure card -> card_legalities row mapping. Legalities are a property of
// the oracle card (the logical card design), not each printing -- unlike
// images, where a reprint can have different artwork, every printing of
// the same oracle card shares the same legality, so this is keyed by
// oracleCardId rather than cardPrintingId. Only format codes this app
// actually tracks (formatIdByCode, from the formats table) are mapped;
// Scryfall tracks a superset (alchemy, historic, etc.) that this schema has
// no format row for, so those keys are silently skipped rather than
// erroring. Also skips a status Scryfall might one day add that isn't in
// card_legalities' check constraint, for the same reason.
export function buildLegalityRows(
  oracleCardId: string,
  card: ScryfallCard,
  formatIdByCode: Map<string, string>,
): CardLegalityRow[] {
  if (!card.legalities) return [];

  const rows: CardLegalityRow[] = [];
  for (const [code, formatId] of formatIdByCode) {
    const status = card.legalities[code];
    if (status && VALID_LEGALITY_STATUSES.has(status)) {
      rows.push({ oracleCardId, formatId, status: status as ScryfallLegalityStatus });
    }
  }
  return rows;
}

async function findPendingPrintings(sql: Sql): Promise<PendingPrinting[]> {
  const rows = await sql<{ card_printing_id: string; oracle_card_id: string; scryfall_id: string }[]>`
    select cp.id as card_printing_id, cp.oracle_card_id, ci.scryfall_id
    from card_printings cp
    join card_identifiers ci on ci.card_printing_id = cp.id
    where ci.scryfall_id is not null
      and not exists (select 1 from card_images cimg where cimg.card_printing_id = cp.id)
  `;

  return rows.map((row) => ({
    cardPrintingId: row.card_printing_id,
    oracleCardId: row.oracle_card_id,
    scryfallId: row.scryfall_id,
  }));
}

async function loadFormatIdByCode(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<{ id: string; code: string }[]>`select id, code from formats`;
  return new Map(rows.map((row) => [row.code, row.id]));
}

// Backfills card_images and card_legalities for every printing that has a
// known Scryfall id but no images yet (backlog: "use Scryfall as the card
// image importer"). Batches lookups through Scryfall's /cards/collection
// endpoint (SCRYFALL_COLLECTION_BATCH_LIMIT per request) rather than one
// request per card. Deliberately stores only the Scryfall-hosted image
// URLs, not the images themselves -- Scryfall's own guidance is to hotlink
// rather than mirror unless there's a specific caching/offline need.
//
// Piggybacking legalities onto the same "pending images" set (rather than
// tracking pending legalities separately) means a printing whose oracle
// card already has legalities from an earlier printing, but which itself
// still needs an image, still gets its (redundant, harmless -- upserted)
// legality row recomputed. The reverse gap -- an oracle card missing
// legalities whose every printing already has images -- is not covered by
// this incremental job; a full-catalogue pass does not have that gap since
// every printing is in scope.
export async function importCardImages(sql: Sql): Promise<ImportCardImagesResult> {
  const [pending, formatIdByCode] = await Promise.all([
    findPendingPrintings(sql),
    loadFormatIdByCode(sql),
  ]);

  let imagesUpserted = 0;
  let legalitiesUpserted = 0;
  let notFound = 0;

  for (const batch of chunk(pending, SCRYFALL_COLLECTION_BATCH_LIMIT)) {
    const response = await fetchCardsByScryfallIds(batch.map((p) => p.scryfallId));
    const cardsById = new Map(response.data.map((card) => [card.id, card]));

    const imageRows: CardImageRow[] = [];
    const legalityRows: CardLegalityRow[] = [];
    const seenOracleCards = new Set<string>();

    for (const printing of batch) {
      const card = cardsById.get(printing.scryfallId);
      if (!card) {
        notFound += 1;
        continue;
      }
      imageRows.push(...buildImageRows(printing.cardPrintingId, card));

      if (!seenOracleCards.has(printing.oracleCardId)) {
        seenOracleCards.add(printing.oracleCardId);
        legalityRows.push(...buildLegalityRows(printing.oracleCardId, card, formatIdByCode));
      }
    }

    if (imageRows.length > 0) {
      await sql`
        insert into card_images ${sql(
          imageRows.map((row) => ({
            card_printing_id: row.cardPrintingId,
            image_type: row.imageType,
            face: row.face,
            url: row.url,
          })),
          "card_printing_id",
          "image_type",
          "face",
          "url",
        )}
        on conflict (card_printing_id, image_type, face) do update set url = excluded.url
      `;
      imagesUpserted += imageRows.length;
    }

    if (legalityRows.length > 0) {
      await sql`
        insert into card_legalities ${sql(
          legalityRows.map((row) => ({
            oracle_card_id: row.oracleCardId,
            format_id: row.formatId,
            status: row.status,
          })),
          "oracle_card_id",
          "format_id",
          "status",
        )}
        on conflict (oracle_card_id, format_id) do update set status = excluded.status, updated_at = now()
      `;
      legalitiesUpserted += legalityRows.length;
    }
  }

  return { printingsProcessed: pending.length, imagesUpserted, legalitiesUpserted, notFound };
}
