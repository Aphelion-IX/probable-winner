import { createServerSupabaseClient } from "@/server/supabase";

// Set-detail table (the "set opened" page): one row per printing+finish,
// not one row per exact SKU -- a printing's conditions/languages all
// collapse into a single row showing the cheapest active price and the
// combined available quantity, matching how the reference layout the user
// asked to match shows exactly one row per finish (e.g. "Foo" and
// "Foo · Foil" as two rows, not one row per condition). representativeSkuId
// is the specific SKU that add-to-cart acts on for that row -- the
// cheapest in-stock condition, or just the cheapest if none are in stock.
export type SetCardRow = {
  printingId: string;
  name: string;
  typeLine: string;
  colors: string[];
  rarity: string;
  collectorNumber: string;
  finishCode: string;
  representativeSkuId: string;
  price: number | null;
  currency: string | null;
  availableQuantity: number;
  imageUrl: string | null;
};

type SkuRow = {
  sku_id: string;
  card_printing_id: string;
  finish_code: string;
  printing_id: string;
  rarity: string;
  collector_number: string;
  name: string;
  type_line: string;
  colors: string[];
};

type OracleCardRef = { id: string; name: string; type_line: string; colors: string[] };
type CardPrintingRef = {
  id: string;
  rarity: string;
  collector_number: string;
  oracle_cards: OracleCardRef | OracleCardRef[];
};
type SkuSelectRow = {
  id: string;
  card_printing_id: string;
  finishes: { code: string } | { code: string }[];
  card_printings: CardPrintingRef | CardPrintingRef[];
};

export type ListSetCardsOptions = {
  inStockOnly?: boolean;
};

// Large sets have thousands of printing+finish rows -- an HTML table that
// size is impractical to render and scroll, so cap the set-detail view at
// this many rows (sorted by name) rather than showing everything.
const MAX_RESULT_ROWS = 200;

// Postgrest doesn't always know a nested embed is to-one without an
// explicit FK hint, so the same relation can come back as an object or a
// single-element array depending on the join path -- same ambiguity
// handled in features/customer/actions/manage-saved-list.ts.
function single<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

// Postgrest caps every response at `max_rows` (1000 in this project's
// supabase/config.toml) regardless of how many rows match -- large sets
// (The List, Secret Lair Drop, Commander Masters, ...) have tens of
// thousands of active SKUs, so a single unpaginated query silently drops
// most of the set's cards. Page through with .range() until a page comes
// back short.
const SKU_PAGE_SIZE = 1000;

// Postgrest's .in() filter puts every id in the URL's query string -- fine
// for a few hundred ids, but the large sets above can have 5,000+ distinct
// printings and 25,000+ skus, which would build a multi-hundred-KB request
// URL. Chunk lookups the same way fetchAllSkuRows pages the base query.
const ID_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchAllSkuRows(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  setCode: string,
): Promise<SkuSelectRow[]> {
  const rows: SkuSelectRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("sellable_skus")
      .select(
        `
        id,
        card_printing_id,
        finishes!inner(code),
        product_statuses!inner(code),
        card_printings!inner(
          id, rarity, collector_number,
          sets!inner(code),
          oracle_cards(id, name, type_line, colors)
        )
      `,
      )
      .eq("card_printings.sets.code", setCode)
      .eq("product_statuses.code", "active")
      .range(offset, offset + SKU_PAGE_SIZE - 1)
      .returns<SkuSelectRow[]>();

    if (error) {
      throw new Error(`Failed to list set cards: ${error.message}`);
    }

    rows.push(...(data ?? []));

    if (!data || data.length < SKU_PAGE_SIZE) {
      return rows;
    }
    offset += SKU_PAGE_SIZE;
  }
}

export async function listSetCards(
  setCode: string,
  options: ListSetCardsOptions = {},
): Promise<SetCardRow[]> {
  const supabase = createServerSupabaseClient();

  const skuRows = await fetchAllSkuRows(supabase, setCode);

  const printingIds = new Set<string>();
  const rows: SkuRow[] = (skuRows ?? []).map((row) => {
    const printing = single(row.card_printings);
    const oracle = single(printing.oracle_cards);
    printingIds.add(printing.id);

    return {
      sku_id: row.id,
      card_printing_id: row.card_printing_id,
      finish_code: single(row.finishes).code,
      printing_id: printing.id,
      rarity: printing.rarity,
      collector_number: printing.collector_number,
      name: oracle.name,
      type_line: oracle.type_line,
      colors: oracle.colors,
    };
  });

  if (rows.length === 0) {
    return [];
  }

  const skuIds = rows.map((r) => r.sku_id);
  const printingIdBatches = chunk(Array.from(printingIds), ID_BATCH_SIZE);
  const skuIdBatches = chunk(skuIds, ID_BATCH_SIZE);

  const [imageResults, priceResults, balanceResults] = await Promise.all([
    Promise.all(
      printingIdBatches.map((batch) =>
        supabase
          .from("card_images")
          .select("card_printing_id, url")
          .in("card_printing_id", batch)
          .eq("image_type", "normal")
          .eq("face", "front"),
      ),
    ),
    Promise.all(
      skuIdBatches.map((batch) =>
        supabase
          .from("published_prices")
          .select("sellable_sku_id, final_amount, currency")
          .in("sellable_sku_id", batch)
          .eq("status", "active"),
      ),
    ),
    Promise.all(
      skuIdBatches.map((batch) =>
        supabase
          .from("inventory_balances")
          .select("sellable_sku_id, quantity_available_online")
          .in("sellable_sku_id", batch),
      ),
    ),
  ]);

  const imageRows = imageResults.flatMap((result) => {
    if (result.error) throw new Error(`Failed to list set card images: ${result.error.message}`);
    return result.data ?? [];
  });
  const priceRows = priceResults.flatMap((result) => {
    if (result.error) throw new Error(`Failed to list set card prices: ${result.error.message}`);
    return result.data ?? [];
  });
  const balanceRows = balanceResults.flatMap((result) => {
    if (result.error)
      throw new Error(`Failed to list set card availability: ${result.error.message}`);
    return result.data ?? [];
  });

  const imageByPrintingId = new Map(
    (imageRows ?? []).map((row) => [row.card_printing_id, row.url]),
  );
  const priceBySkuId = new Map(
    (priceRows ?? []).map((row) => [
      row.sellable_sku_id,
      { amount: row.final_amount as number, currency: row.currency as string },
    ]),
  );
  const availabilityBySkuId = new Map<string, number>();
  for (const row of balanceRows ?? []) {
    availabilityBySkuId.set(
      row.sellable_sku_id,
      (availabilityBySkuId.get(row.sellable_sku_id) ?? 0) + (row.quantity_available_online ?? 0),
    );
  }

  type Group = {
    printingId: string;
    name: string;
    typeLine: string;
    colors: string[];
    rarity: string;
    collectorNumber: string;
    finishCode: string;
    imageUrl: string | null;
    totalAvailable: number;
    bestPrice: { amount: number; currency: string; skuId: string } | null;
    fallbackSkuId: string;
  };

  const groups = new Map<string, Group>();

  for (const row of rows) {
    const key = `${row.printing_id}|${row.finish_code}`;
    const available = availabilityBySkuId.get(row.sku_id) ?? 0;
    const price = priceBySkuId.get(row.sku_id) ?? null;

    let group = groups.get(key);
    if (!group) {
      group = {
        printingId: row.printing_id,
        name: row.name,
        typeLine: row.type_line,
        colors: row.colors,
        rarity: row.rarity,
        collectorNumber: row.collector_number,
        finishCode: row.finish_code,
        imageUrl: imageByPrintingId.get(row.printing_id) ?? null,
        totalAvailable: 0,
        bestPrice: null,
        fallbackSkuId: row.sku_id,
      };
      groups.set(key, group);
    }

    group.totalAvailable += available;
    if (price && (!group.bestPrice || price.amount < group.bestPrice.amount)) {
      group.bestPrice = { amount: price.amount, currency: price.currency, skuId: row.sku_id };
    }
  }

  const result: SetCardRow[] = Array.from(groups.values())
    .filter((group) => !options.inStockOnly || group.totalAvailable > 0)
    .map((group) => ({
      printingId: group.printingId,
      name: group.name,
      typeLine: group.typeLine,
      colors: group.colors,
      rarity: group.rarity,
      collectorNumber: group.collectorNumber,
      finishCode: group.finishCode,
      representativeSkuId: group.bestPrice?.skuId ?? group.fallbackSkuId,
      price: group.bestPrice?.amount ?? null,
      currency: group.bestPrice?.currency ?? null,
      availableQuantity: group.totalAvailable,
      imageUrl: group.imageUrl,
    }));

  result.sort((a, b) => a.name.localeCompare(b.name) || a.finishCode.localeCompare(b.finishCode));

  return result.slice(0, MAX_RESULT_ROWS);
}
