// Pure SKU-row -> CardSearchDocument mapping (backlog B-081/B-083). Kept
// free of any DB/Typesense client so it's testable without either.

import type { CardSearchDocument } from "./typesense-schema";

export type SkuSearchInput = {
  skuId: string;
  oracleCardId: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  cmc: number | null;
  colorIdentity: string[];
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  artistName: string | null;
  imageUrl: string | null;
  finishCode: string;
  conditionCode: string;
  languageCode: string;
  legality: Record<string, string>;
  priceAmount: number | null;
  priceCurrency: string | null;
  quantityAvailable: number;
  quantityInStores: Record<string, number>;
  popularityScore?: number;
};

export function buildCardSearchDocument(input: SkuSearchInput): CardSearchDocument {
  return {
    id: input.skuId,
    oracle_id: input.oracleCardId,
    name: input.name,
    set_code: input.setCode,
    set_name: input.setName,
    collector_number: input.collectorNumber,
    rarity: input.rarity as CardSearchDocument["rarity"],
    artist: input.artistName ?? "",
    colour_identity: input.colorIdentity,
    colour_count: input.colorIdentity.length,
    mana_cost: input.manaCost ?? "",
    cmc: input.cmc ?? 0,
    type_line: input.typeLine,
    finish: input.finishCode as CardSearchDocument["finish"],
    condition: input.conditionCode as CardSearchDocument["condition"],
    language: input.languageCode,
    layout: "normal",
    legality: input.legality as CardSearchDocument["legality"],
    price_amount: input.priceAmount ?? 0,
    price_currency: input.priceCurrency ?? "AUD",
    quantity_available: input.quantityAvailable,
    quantity_in_stores: input.quantityInStores,
    popularity_score: input.popularityScore ?? 0,
    last_updated_at: Date.now(),
  };
}
