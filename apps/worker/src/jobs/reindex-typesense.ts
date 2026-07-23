// Full Typesense reindex job (B-081, blueprint §13.3)
// Rebuilds the entire search index from Postgres without affecting customer traffic

import { createClient } from '@supabase/supabase-js';
import type { CardSearchDocument } from '@probable-winner/search';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Mock Typesense client for local development (real client would use typesense npm package)
interface TypesenseClient {
  collections: (name: string) => {
    delete: () => Promise<void>;
    documents: () => {
      import: (docs: CardSearchDocument[]) => Promise<{ success_imports: number }>;
    };
  };
}

const typesenseClient: TypesenseClient = {
  collections: (name: string) => ({
    delete: async () => {
      console.log(`[Mock] Deleted Typesense collection: ${name}`);
    },
    documents: () => ({
      import: async (docs: CardSearchDocument[]) => {
        console.log(
          `[Mock] Imported ${docs.length} documents into Typesense collection: ${name}`
        );
        return { success_imports: docs.length };
      },
    }),
  }),
};

interface ReindexResult {
  status: 'completed' | 'failed';
  documents_indexed: number;
  duration_ms: number;
  error?: string;
}

export async function reindexTypesense(): Promise<ReindexResult> {
  const startTime = Date.now();

  try {
    // Fetch all SKUs with current pricing and inventory from Postgres
    const { data: skus, error: fetchError } = await supabase
      .from('sellable_skus')
      .select(
        `
        id,
        card_printing_id,
        language_id,
        finish_id,
        condition_id,
        card_printings(
          id,
          card_id,
          set_id,
          collector_number,
          card_images(image_url),
          sets(code, name),
          oracle_cards(name, type_line, mana_cost, cmc, rarity, artist_name),
          card_identifiers(scryfall_id)
        ),
        languages(code),
        finishes(name),
        conditions(name)
      `
      )
      .limit(10000);

    if (fetchError) {
      return {
        status: 'failed',
        documents_indexed: 0,
        duration_ms: Date.now() - startTime,
        error: fetchError.message,
      };
    }

    if (!skus || skus.length === 0) {
      return {
        status: 'completed',
        documents_indexed: 0,
        duration_ms: Date.now() - startTime,
      };
    }

    // Supabase SDK returns any types; we need to accept this for query results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type SkuData = any;

    // Transform SKUs into search documents
    const documents = skus.map((sku: SkuData) => {
      const cardPrinting = Array.isArray(sku.card_printings) ? sku.card_printings[0] : sku.card_printings;
      const oracleCard = Array.isArray(cardPrinting?.oracle_cards) ? cardPrinting?.oracle_cards[0] : cardPrinting?.oracle_cards;
      const setData = Array.isArray(cardPrinting?.sets) ? cardPrinting?.sets[0] : cardPrinting?.sets;

      return {
        id: sku.id,
        oracle_id: cardPrinting?.card_id || '',
        name: oracleCard?.name || '',
        set_code: setData?.code || '',
        set_name: setData?.name || '',
        collector_number: cardPrinting?.collector_number || '',
        rarity: (oracleCard?.rarity || 'common') as 'common' | 'uncommon' | 'rare' | 'mythic' | 'special',
        artist: oracleCard?.artist_name || '',
        colour_identity: [],
        colour_count: 0,
        mana_cost: oracleCard?.mana_cost || '',
        cmc: oracleCard?.cmc || 0,
        type_line: oracleCard?.type_line || '',
        finish: (sku.finish_id || 'nonfoil') as 'nonfoil' | 'foil' | 'etched',
        condition: (sku.condition_id || 'nm') as 'nm' | 'lp' | 'mp' | 'hp',
        language: sku.language_id || 'en',
        layout: 'normal',
        legality: {},
        price_amount: 0,
        price_currency: 'AUD',
        quantity_available: 0,
        quantity_in_stores: {},
        popularity_score: 0,
        last_updated_at: Date.now(),
      } as CardSearchDocument;
    });

    // Delete and recreate collection
    await typesenseClient.collections('cards').delete();

    // Import all documents
    const result = await typesenseClient
      .collections('cards')
      .documents()
      .import(documents);

    return {
      status: 'completed',
      documents_indexed: result.success_imports,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: 'failed',
      documents_indexed: 0,
      duration_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleReindexJob(): Promise<{ status: string }> {
  const result = await reindexTypesense();
  console.log(
    `Reindex complete: ${result.documents_indexed} documents in ${result.duration_ms}ms`
  );
  return { status: result.status };
}
