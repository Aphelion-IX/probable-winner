// Card search document shape (B-080, blueprint §13.2). Backend-agnostic --
// this used to double as a Typesense collection schema; now it's just the
// document contract shared between the worker's search index and the web
// app's search queries.

export interface CardSearchDocument {
  id: string; // SKU ID
  printing_id: string; // card_printings ID -- the card identity page's route param, distinct from the SKU id above
  oracle_id: string; // Oracle card ID for grouping printings
  name: string; // Card name (for text search)
  set_code: string; // Set code (e.g., "MH2")
  set_name: string; // Set name (e.g., "Modern Horizons 2")
  collector_number: string; // Collector number in set
  rarity: "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";
  artist: string; // Card artist
  image_url: string; // card_images URL for this printing, "" when none catalogued
  colour_identity: string[]; // Colour codes ['W', 'U', 'B', 'R', 'G']
  colour_count: number; // Count of colours in identity
  mana_cost: string; // Stringified mana cost (e.g., "{1}{U}{B}")
  cmc: number; // Converted mana cost
  type_line: string; // Type line (e.g., "Creature — Zombie Wizard")
  finish: "nonfoil" | "foil" | "etched"; // Finish type
  condition: "nm" | "lp" | "mp" | "hp" | "dmg"; // Condition code
  language: string; // Language code (e.g., "en", "ja")
  layout: string; // Card layout (e.g., "normal", "modal_dfc", "token")
  legality: Record<string, "legal" | "not_legal" | "restricted" | "banned">; // Format legalities
  price_amount: number; // Current price (for sorting/filtering)
  price_currency: string; // Currency code (e.g., "AUD", "USD")
  quantity_available: number; // Available inventory count across all stores
  quantity_in_stores: Record<string, number>; // Quantity per store ID
  popularity_score: number; // Computed popularity (0-100 scale for ranking)
  last_updated_at: number; // Unix timestamp of last price/inventory update
  catalogued_at: number; // Unix timestamp the printing was catalogued (card_printings.created_at) -- backs the "recently added" feed (B-193)
}
