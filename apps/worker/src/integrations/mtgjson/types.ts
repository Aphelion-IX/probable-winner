// Local types for the subset of MTGJSON's v5 per-set REST files
// (https://mtgjson.com/api/v5/{SET}.json) this importer actually reads.
// Not using the `mtggraphql` package's types here: those are codegen'd from
// the MTGGraphQL GraphQL schema (Maybe<T>/__typename wrappers) for querying
// that API, not for parsing the raw JSON files we download directly.

export type MtgJsonIdentifiers = {
  scryfallId?: string;
  scryfallOracleId?: string;
  mtgjsonV4Id?: string;
  tcgplayerProductId?: string;
  mcmId?: string;
  multiverseId?: string;
};

export type MtgJsonCard = {
  uuid: string;
  name: string;
  number: string;
  setCode: string;
  rarity: string;
  type: string;
  text?: string;
  manaCost?: string;
  manaValue?: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  colorIdentity?: string[];
  finishes?: string[];
  borderColor?: string;
  frameVersion?: string;
  flavorText?: string;
  isPromo?: boolean;
  isAlternative?: boolean;
  artist?: string;
  identifiers: MtgJsonIdentifiers;
  legalities?: Record<string, string>;
};

export type MtgJsonSet = {
  code: string;
  name: string;
  type: string;
  releaseDate: string;
  baseSetSize?: number;
  totalSetSize?: number;
  cards: MtgJsonCard[];
};

export type MtgJsonSetResponse = {
  data: MtgJsonSet;
};
