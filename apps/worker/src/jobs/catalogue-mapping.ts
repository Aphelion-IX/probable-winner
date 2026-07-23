import type { MtgJsonCard, MtgJsonSet } from "../integrations/mtgjson/types.js";

export type OracleCardRow = {
  scryfallOracleId: string;
  name: string;
  manaCost: string | null;
  cmc: number | null;
  typeLine: string;
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string[];
  colorIdentity: string[];
};

export type PrintingRow = {
  collectorNumber: string;
  rarity: string;
  finishes: string[];
  frame: string | null;
  borderColor: string | null;
  flavorText: string | null;
  isPromo: boolean;
  isVariation: boolean;
  artistName: string | null;
};

export type IdentifiersRow = {
  mtgjsonUuid: string | null;
  scryfallId: string | null;
  tcgplayerProductId: number | null;
  cardmarketId: number | null;
  multiverseIds: number[];
};

export type SetRow = {
  code: string;
  name: string;
  setType: string | null;
  releasedAt: string | null;
  cardCount: number;
};

// Card identity mapping (backlog B-042): a card's oracle identity is shared
// across every printing with the same scryfall_oracle_id — e.g. Arabian
// Nights' "variable rarity" cards (Army of Allah #2 and #2†) are two
// card_printings rows sharing one oracle_cards row. Callers upsert this by
// (game_id, scryfall_oracle_id), so mapping the same oracle card twice is
// expected and must be safe/idempotent, not an error.
export function mapOracleCard(card: MtgJsonCard): OracleCardRow {
  return {
    scryfallOracleId: card.identifiers.scryfallOracleId ?? card.uuid,
    name: card.name,
    manaCost: card.manaCost ?? null,
    cmc: card.manaValue ?? null,
    typeLine: card.type,
    oracleText: card.text ?? null,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    loyalty: card.loyalty ?? null,
    colors: card.colors ?? [],
    colorIdentity: card.colorIdentity ?? [],
  };
}

export function mapPrinting(card: MtgJsonCard): PrintingRow {
  return {
    collectorNumber: card.number,
    rarity: card.rarity,
    finishes: card.finishes ?? [],
    frame: card.frameVersion ?? null,
    borderColor: card.borderColor ?? null,
    flavorText: card.flavorText ?? null,
    isPromo: card.isPromo ?? false,
    isVariation: card.isAlternative ?? false,
    artistName: card.artist ?? null,
  };
}

export function mapIdentifiers(card: MtgJsonCard): IdentifiersRow {
  const { identifiers } = card;
  return {
    mtgjsonUuid: identifiers.mtgjsonV4Id ?? null,
    scryfallId: identifiers.scryfallId ?? null,
    tcgplayerProductId: identifiers.tcgplayerProductId
      ? Number(identifiers.tcgplayerProductId)
      : null,
    cardmarketId: identifiers.mcmId ? Number(identifiers.mcmId) : null,
    multiverseIds: identifiers.multiverseId ? [Number(identifiers.multiverseId)] : [],
  };
}

export function mapSet(set: Omit<MtgJsonSet, "cards">): SetRow {
  return {
    code: set.code,
    name: set.name,
    setType: set.type ?? null,
    releasedAt: set.releaseDate ?? null,
    cardCount: set.totalSetSize ?? set.baseSetSize ?? 0,
  };
}
