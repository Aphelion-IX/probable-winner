import type { Sql } from "postgres";

import {
  fetchBulkDataCatalog,
  findBulkDataEntry,
  streamBulkDataCards,
  ScryfallValidationError,
} from "../integrations/scryfall/client.js";
import { buildImageRows, type CardImageRow } from "./import-card-images.js";
import type { ScryfallCard } from "../integrations/scryfall/types.js";

export type SyncCardImagesBulkResult = {
  knownPrintings: number;
  cardsScanned: number;
  printingsMatched: number;
  imagesUpserted: number;
};

// Flushed periodically rather than buffering the whole catalogue's image
// rows in memory -- the bulk file itself is streamed for the same reason.
const FLUSH_SIZE = 500;

async function loadKnownScryfallIds(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<{ card_printing_id: string; scryfall_id: string }[]>`
    select card_printing_id, scryfall_id from card_identifiers where scryfall_id is not null
  `;

  return new Map(rows.map((row) => [row.scryfall_id, row.card_printing_id]));
}

async function upsertImageRows(sql: Sql, rows: CardImageRow[]): Promise<void> {
  if (rows.length === 0) return;

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
}

// Full-catalogue image sync via Scryfall's daily bulk-data export --
// "use Scryfall's bulk-data export instead of requesting every card
// individually" for the internal catalogue. One gzipped JSONL download
// (streamBulkDataCards) instead of one /cards/collection request per 75
// printings (fetchCardsByScryfallIds in import-card-images.ts, still the
// right tool for a small/urgent top-up -- see that function's own comment
// on why both exist). Existing collection data (inventory, orders, etc.)
// is never touched here -- this only ever upserts card_images rows for
// printings whose scryfall_id it already knows about; it does not create
// new card_printings or oracle_cards (that stays the MTGJSON importer's
// job).
export async function syncCardImagesFromBulkData(sql: Sql): Promise<SyncCardImagesBulkResult> {
  const known = await loadKnownScryfallIds(sql);

  const result: SyncCardImagesBulkResult = {
    knownPrintings: known.size,
    cardsScanned: 0,
    printingsMatched: 0,
    imagesUpserted: 0,
  };

  if (known.size === 0) {
    return result;
  }

  const catalog = await fetchBulkDataCatalog();
  const entry = findBulkDataEntry(catalog, "default_cards");

  if (!entry?.jsonl_download_uri) {
    throw new ScryfallValidationError(
      "Scryfall bulk-data catalog has no default_cards jsonl_download_uri",
    );
  }

  let buffer: CardImageRow[] = [];

  async function flush() {
    await upsertImageRows(sql, buffer);
    result.imagesUpserted += buffer.length;
    buffer = [];
  }

  await streamBulkDataCards(entry.jsonl_download_uri, async (card: ScryfallCard) => {
    result.cardsScanned += 1;

    const cardPrintingId = known.get(card.id);
    if (!cardPrintingId) {
      return;
    }

    result.printingsMatched += 1;
    buffer.push(...buildImageRows(cardPrintingId, card));

    if (buffer.length >= FLUSH_SIZE) {
      await flush();
    }
  });

  await flush();

  return result;
}
