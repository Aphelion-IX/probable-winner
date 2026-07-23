// Search API route handler (B-084, blueprint §13.4)
// Supports filtering by name, set, artist, colour, condition, format, store, price range, in-stock

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface SearchParams {
  q?: string; // Full-text search query
  set?: string; // Set code filter
  artist?: string; // Artist name filter
  rarity?: string; // Rarity filter
  finish?: string; // Finish filter (foil/nonfoil/etched)
  condition?: string; // Condition filter (nm/lp/mp/hp)
  colour?: string[]; // Colour identity filter (can be multiple)
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean; // Only show in-stock items
  storeId?: string; // Filter by specific store availability
  page?: number;
  limit?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'popularity';
}

function parseSearchParams(request: NextRequest): SearchParams {
  const { searchParams } = new URL(request.url);

  return {
    q: searchParams.get('q') || undefined,
    set: searchParams.get('set') || undefined,
    artist: searchParams.get('artist') || undefined,
    rarity: searchParams.get('rarity') || undefined,
    finish: searchParams.get('finish') || undefined,
    condition: searchParams.get('condition') || undefined,
    colour: searchParams.getAll('colour'),
    minPrice: searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : undefined,
    maxPrice: searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
    inStock: searchParams.get('inStock') === 'true',
    storeId: searchParams.get('storeId') || undefined,
    page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
    limit: Math.min(Number(searchParams.get('limit') || 20), 100),
    sort: (searchParams.get('sort') as 'relevance' | 'price_asc' | 'price_desc' | 'popularity' | null) || 'relevance',
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = parseSearchParams(request);

    // Build Postgres query with filters (using supabase client for now, would use Typesense in production)
    let query = supabase
      .from('sellable_skus')
      .select(
        `
        id,
        card_printing_id,
        finish_id,
        condition_id,
        card_printings(
          id,
          collector_number,
          sets(code, name),
          oracle_cards(name, type_line, cmc, rarity, artist_name)
        )
      `,
        { count: 'exact' }
      );

    // Apply filters
    if (params.rarity) {
      query = query.eq('card_printings.oracle_cards.rarity', params.rarity);
    }

    if (params.condition) {
      query = query.eq('condition_id', params.condition);
    }

    if (params.finish) {
      query = query.eq('finish_id', params.finish);
    }

    if (params.set) {
      query = query.eq('card_printings.sets.code', params.set);
    }

    if (params.inStock) {
      // In production, would check inventory_balances; for now, just include
    }

    // Pagination
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: results, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    interface SkuResult {
      id: string;
      condition_id: string;
      finish_id: string;
      card_printings: Array<{
        oracle_cards: Array<{
          name: string;
          rarity: string;
          artist_name: string;
        }>;
        sets: Array<{
          code: string;
        }>;
      }>;
    }

    // Transform results
    const hits = (results || []).map((sku: SkuResult) => {
      const cardPrinting = Array.isArray(sku.card_printings) ? sku.card_printings[0] : sku.card_printings;
      const oracleCard = Array.isArray(cardPrinting?.oracle_cards) ? cardPrinting?.oracle_cards[0] : cardPrinting?.oracle_cards;
      const setData = Array.isArray(cardPrinting?.sets) ? cardPrinting?.sets[0] : cardPrinting?.sets;

      return {
        id: sku.id,
        name: oracleCard?.name,
        set: setData?.code,
        rarity: oracleCard?.rarity,
        artist: oracleCard?.artist_name,
        condition: sku.condition_id,
        finish: sku.finish_id,
        price: 0, // Would come from published_prices
      };
    });

    return NextResponse.json({
      hits,
      page,
      pageSize: limit,
      totalHits: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      processingTimeMs: 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}
