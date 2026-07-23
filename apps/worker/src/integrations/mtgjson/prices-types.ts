// Local types for MTGJSON's v5 AllPricesToday feed
// (https://mtgjson.com/api/v5/AllPricesToday.json): one day's price per
// provider/list-type/finish, no historical date nesting. Keyed by the same
// mtgjsonV4Id that catalogue-mapping.ts's mapIdentifiers() already captures
// into card_identifiers.mtgjson_uuid during catalogue import -- that's the
// id this adapter's ImportedPrice.sourceProductId values are matched
// against when the import job resolves them to a card_printing_id.

export type MtgJsonPriceListType = "retail" | "buylist";
export type MtgJsonPriceFinish = "normal" | "foil" | "etched";

export type MtgJsonProviderPrices = Partial<
  Record<MtgJsonPriceListType, Partial<Record<MtgJsonPriceFinish, number>>>
>;

export type MtgJsonCardPrices = {
  paper?: Record<string, MtgJsonProviderPrices>;
};

export type MtgJsonAllPricesTodayResponse = {
  meta: { date: string; version: string };
  data: Record<string, MtgJsonCardPrices>;
};
