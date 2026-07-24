import type { Sql } from "postgres";

import {
  fetchCardsByScryfallIds,
  SCRYFALL_COLLECTION_BATCH_LIMIT,
} from "../integrations/scryfall/client.js";
import type { ScryfallCard } from "../integrations/scryfall/types.js";

export type PendingPrinting = {
  cardPrintingId: string;
  scryfallId: string;
};

export type CardImageRow = {
  cardPrintingId: string;
  imageType: "small" | "normal" | "large" | "png" | "art_crop" | "border_crop";
  face: "front" | "back";
  url: string;
};

export type ImportCardImagesResult = {
  printingsProcessed: number;
  imagesUpserted: number;
  notFound: number;
};

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

async function findPendingPrintings(sql: Sql): Promise<PendingPrinting[]> {
  const rows = await sql<{ card_printing_id: string; scryfall_id: string }[]>`
    select cp.id as card_printing_id, ci.scryfall_id
    from card_printings cp
    join card_identifiers ci on ci.card_printing_id = cp.id
    where ci.scryfall_id is not null
      and not exists (select 1 from card_images cimg where cimg.card_printing_id = cp.id)
  `;

  return rows.map((row) => ({ cardPrintingId: row.card_printing_id, scryfallId: row.scryfall_id }));
}

// Backfills card_images for every printing that has a known Scryfall id
// but no images yet (backlog: "use Scryfall as the card image importer").
// Batches lookups through Scryfall's /cards/collection endpoint
// (SCRYFALL_COLLECTION_BATCH_LIMIT per request) rather than one request per
// card. Deliberately stores only the Scryfall-hosted URLs, not the images
// themselves -- Scryfall's own guidance is to hotlink rather than mirror
// unless there's a specific caching/offline need.
export async function importCardImages(sql: Sql): Promise<ImportCardImagesResult> {
  const pending = await findPendingPrintings(sql);

  let imagesUpserted = 0;
  let notFound = 0;

  for (const batch of chunk(pending, SCRYFALL_COLLECTION_BATCH_LIMIT)) {
    const response = await fetchCardsByScryfallIds(batch.map((p) => p.scryfallId));
    const cardsById = new Map(response.data.map((card) => [card.id, card]));

    const rows: CardImageRow[] = [];
    for (const printing of batch) {
      const card = cardsById.get(printing.scryfallId);
      if (!card) {
        notFound += 1;
        continue;
      }
      rows.push(...buildImageRows(printing.cardPrintingId, card));
    }

    if (rows.length > 0) {
      await sql`
        insert into card_images ${sql(
          rows.map((row) => ({
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
      imagesUpserted += rows.length;
    }
  }

  return { printingsProcessed: pending.length, imagesUpserted, notFound };
}
