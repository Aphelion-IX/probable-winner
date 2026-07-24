// Minimal shape of what we actually consume from Scryfall's card object
// (https://scryfall.com/docs/api/cards) -- not a full mirror of their schema.

export type ScryfallImageUris = {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
};

export type ScryfallCardFace = {
  name: string;
  image_uris?: ScryfallImageUris;
};

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
};

export type ScryfallCollectionResponse = {
  object: "list";
  not_found: Array<{ id?: string }>;
  data: ScryfallCard[];
};

// https://scryfall.com/docs/api/bulk-data
export type ScryfallBulkDataType =
  | "oracle_cards"
  | "unique_artwork"
  | "default_cards"
  | "all_cards"
  | "rulings"
  | "art_tags"
  | "oracle_tags";

export type ScryfallBulkDataEntry = {
  id: string;
  type: ScryfallBulkDataType;
  name: string;
  download_uri: string;
  jsonl_download_uri?: string;
  updated_at: string;
  size: number;
};

export type ScryfallBulkDataResponse = {
  object: "list";
  data: ScryfallBulkDataEntry[];
};

// https://scryfall.com/docs/api/sets
export type ScryfallSet = {
  id: string;
  code: string;
  name: string;
  icon_svg_uri?: string;
};

export type ScryfallSetsResponse = {
  object: "list";
  has_more: boolean;
  data: ScryfallSet[];
};
