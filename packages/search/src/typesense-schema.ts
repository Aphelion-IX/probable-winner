// Typesense collection schema for card search (B-080, blueprint §13.2)
// Defines the shape of documents indexed for full-text and faceted search

import type { CollectionCreateSchema, CollectionFieldSchema } from 'typesense';

export interface CardSearchDocument {
  id: string; // SKU ID
  oracle_id: string; // Oracle card ID for grouping printings
  name: string; // Card name (for text search)
  set_code: string; // Set code (e.g., "MH2")
  set_name: string; // Set name (e.g., "Modern Horizons 2")
  collector_number: string; // Collector number in set
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';
  artist: string; // Card artist
  colour_identity: string[]; // Colour codes ['W', 'U', 'B', 'R', 'G']
  colour_count: number; // Count of colours in identity
  mana_cost: string; // Stringified mana cost (e.g., "{1}{U}{B}")
  cmc: number; // Converted mana cost
  type_line: string; // Type line (e.g., "Creature — Zombie Wizard")
  finish: 'nonfoil' | 'foil' | 'etched'; // Finish type
  condition: 'nm' | 'lp' | 'mp' | 'hp' | 'dmg'; // Condition code
  language: string; // Language code (e.g., "en", "ja")
  layout: string; // Card layout (e.g., "normal", "modal_dfc", "token")
  legality: Record<string, 'legal' | 'not_legal' | 'restricted' | 'banned'>; // Format legalities
  price_amount: number; // Current price (for sorting/filtering)
  price_currency: string; // Currency code (e.g., "AUD", "USD")
  quantity_available: number; // Available inventory count across all stores
  quantity_in_stores: Record<string, number>; // Quantity per store ID
  popularity_score: number; // Computed popularity (0-100 scale for ranking)
  last_updated_at: number; // Unix timestamp of last price/inventory update
}

const fields: CollectionFieldSchema[] = [
  { name: 'id', type: 'string', facet: false },
  { name: 'oracle_id', type: 'string', facet: true },
  { name: 'name', type: 'string', facet: false },
  { name: 'set_code', type: 'string', facet: true },
  { name: 'set_name', type: 'string', facet: true },
  { name: 'collector_number', type: 'string', facet: false },
  { name: 'rarity', type: 'string', facet: true },
  { name: 'artist', type: 'string', facet: true },
  { name: 'colour_identity', type: 'string[]', facet: true },
  { name: 'colour_count', type: 'int32', facet: true },
  { name: 'mana_cost', type: 'string', facet: false },
  { name: 'cmc', type: 'int32', facet: true },
  { name: 'type_line', type: 'string', facet: false },
  { name: 'finish', type: 'string', facet: true },
  { name: 'condition', type: 'string', facet: true },
  { name: 'language', type: 'string', facet: true },
  { name: 'layout', type: 'string', facet: true },
  { name: 'legality', type: 'object', facet: false },
  { name: 'price_amount', type: 'float', facet: false },
  { name: 'price_currency', type: 'string', facet: true },
  { name: 'quantity_available', type: 'int32', facet: false },
  { name: 'quantity_in_stores', type: 'object', facet: false },
  { name: 'popularity_score', type: 'float', facet: false },
  { name: 'last_updated_at', type: 'int64', facet: false },
];

export const typesenseCollectionSchema: CollectionCreateSchema = {
  name: 'cards',
  fields,
  // Required by Typesense whenever a collection has 'object'/'object[]'
  // fields (legality, quantity_in_stores here).
  enable_nested_fields: true,
  default_sorting_field: 'popularity_score',
};
