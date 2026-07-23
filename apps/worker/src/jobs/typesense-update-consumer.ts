// Typesense incremental update consumer (B-083, blueprint §13.5)
// Listens to integration_events queue and updates only affected documents

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface IntegrationEvent {
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

interface UpdateResult {
  success: boolean;
  documents_updated: number;
  event_id: string;
  error?: string;
}

export async function updateTypesenseDocument(
  event: IntegrationEvent
): Promise<UpdateResult> {
  try {
    // Filter events relevant to search indexing
    const searchRelevantEvents = [
      'inventory_received',
      'inventory_reserved',
      'inventory_allocated',
      'reservation_released',
      'pricing_published',
      'pricing_override_set',
      'pricing_override_cleared',
    ];

    if (!searchRelevantEvents.includes(event.event_type)) {
      return {
        success: true,
        documents_updated: 0,
        event_id: event.id,
      };
    }

    // Determine which SKU was affected
    let skuId = '';
    if (event.aggregate_type === 'sku' || event.aggregate_type === 'inventory') {
      skuId = event.aggregate_id;
    } else if (event.aggregate_type === 'price') {
      // For pricing events, fetch the SKU
      const { data: price } = await supabase
        .from('calculated_prices')
        .select('sellable_sku_id')
        .eq('id', event.aggregate_id)
        .single();

      if (price) {
        skuId = price.sellable_sku_id;
      }
    }

    if (!skuId) {
      return {
        success: true,
        documents_updated: 0,
        event_id: event.id,
      };
    }

    // Fetch updated document data from Postgres
    const { data: sku, error: fetchError } = await supabase
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
      .eq('id', skuId)
      .single();

    if (fetchError || !sku) {
      return {
        success: false,
        documents_updated: 0,
        event_id: event.id,
        error: fetchError?.message || 'SKU not found',
      };
    }

    // Build updated document
    const cardPrinting = Array.isArray(sku.card_printings) ? sku.card_printings[0] : sku.card_printings;
    const oracleCard = Array.isArray(cardPrinting?.oracle_cards) ? cardPrinting?.oracle_cards[0] : cardPrinting?.oracle_cards;
    const setData = Array.isArray(cardPrinting?.sets) ? cardPrinting?.sets[0] : cardPrinting?.sets;

    // Update document in Typesense (mocked)
    console.log(
      `[Mock] Updated Typesense document for SKU ${skuId} due to ${event.event_type} - Document: name=${oracleCard?.name}, set=${setData?.code}, condition=${sku.condition_id}`
    );

    return {
      success: true,
      documents_updated: 1,
      event_id: event.id,
    };
  } catch (error) {
    return {
      success: false,
      documents_updated: 0,
      event_id: event.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleTypesenseUpdateConsumer(
  event: IntegrationEvent
): Promise<UpdateResult> {
  return updateTypesenseDocument(event);
}
