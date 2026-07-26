import { createServerSupabaseClient } from "@/server/supabase";
import { CARD_COLORS, CARD_FINISHES, onlyKnown, type CardColor } from "./list-cards";

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
  borderColor: string | null;
  representativeSkuId: string;
  price: number | null;
  currency: string | null;
  availableQuantity: number;
  imageUrl: string | null;
};

// The schema has no dedicated "full art"/frame-effects column -- border_color
// is the closest real attribute to a visual "treatment", with "borderless"
// standing in for full-art/showcase-style prints.
import { CARD_BORDER_COLORS } from "@/features/catalogue/lib/card-facets";

export { CARD_BORDER_COLORS, SET_CARD_SORTS } from "@/features/catalogue/lib/card-facets";
export type { CardBorderColor, SetCardSort } from "@/features/catalogue/lib/card-facets";

type SkuRow = {
  sku_id: string;
  card_printing_id: string;
  finish_code: string;
  printing_id: string;
  rarity: string;
  collector_number: string;
  border_color: string | null;
  name: string;
  type_line: string;
  colors: string[];
};

type OracleCardRef = { id: string; name: string; type_line: string; colors: string[] };
type CardPrintingRef = {
  id: string;
  rarity: string;
  collector_number: string;
  border_color: string | null;
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
  colors?: string[];
  finishes?: string[];
  borderColors?: string[];
  sort?: string;
};

// Mirrors buildColorFilter in list-cards.ts (same colourless-vs-chromatic OR
// semantics), but applied to an already-fetched row's colors array instead
// of building a Postgrest filter string.
function matchesColorFilter(rowColors: string[], colors: CardColor[]): boolean {
  if (colors.length === 0) return true;
  const chromatic = colors.filter((color) => color !== "C");
  if (rowColors.length === 0) return colors.includes("C");
  return chromatic.some((color) => rowColors.includes(color));
}

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
// 1000 ids keeps the query string comfortably under typical proxy/gateway
// URL-length limits while roughly halving the number of chunk requests
// needed for the largest sets versus a smaller batch size.
const ID_BATCH_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Real sets routinely fan out into 5-10+ paginated/batched Supabase requests
// (see fetchAllSkuRows and the image/price/balance batches below). Firing
// all of them at once reliably starts failing with a plain "TypeError:
// fetch failed" once the count gets much past this -- observed consistently
// (not just occasionally) against a real large set, so it isn't transient
// flakiness a retry alone fixes. Cap how many of these run concurrently;
// runWithConcurrencyLimit below enforces it.
const MAX_CONCURRENT_REQUESTS = 4;

// A retry still matters for whatever residual flakiness a concurrency cap
// doesn't eliminate (a single request can still transiently fail even when
// the network isn't overloaded).
async function withRetry<T extends { error: { message: string } | null }>(
  fn: () => PromiseLike<T>,
  attempts = 3,
): Promise<T> {
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      lastResult = await fn();
      if (!lastResult.error) return lastResult;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      continue;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  return lastResult!;
}

// Runs `tasks` with at most `limit` in flight at once -- unlike
// Promise.all(tasks.map(...)), which starts everything immediately.
async function runWithConcurrencyLimit<R>(
  tasks: Array<() => Promise<R>>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// No sets join: the set is resolved to its printing ids up front (see
// fetchSetPrintingIds), so nothing here needs to reach through to sets.code,
// and none of the mapping below ever read it.
const SKU_SELECT_COLUMNS = `
  id,
  card_printing_id,
  finishes!inner(code),
  product_statuses!inner(code),
  card_printings!inner(
    id, rarity, collector_number, border_color,
    oracle_cards(id, name, type_line, colors)
  )
`;

// Resolves a set code to the ids of its printings.
//
// This exists to keep the sku query off a full-table scan. Postgrest turns a
// filter on a *nested* resource (`card_printings.sets.code`) into a
// correlated LATERAL join, which it cannot push down into the outer table --
// so it walks all ~816k sellable_skus rows and runs the join per row just to
// keep the few thousand belonging to one set. Measured on the real database
// that costs ~830-1,080 ms per call; the same logical query written as a
// plain join over indexed columns (sets.code -> card_printings.set_id ->
// sellable_skus.card_printing_id) plans as three index scans and runs in
// ~18 ms.
//
// Filtering on card_printing_id instead means the predicate is on an indexed
// column of the table actually being scanned (sellable_skus_printing_idx),
// which is what makes that index scan available.
async function fetchSetPrintingIds(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  setCode: string,
): Promise<string[]> {
  const setResult = await withRetry(() =>
    supabase.from("sets").select("id").eq("code", setCode).limit(1).maybeSingle(),
  );

  if (setResult.error) {
    throw new Error(`Failed to list set cards: ${setResult.error.message}`);
  }

  const setId = (setResult.data as { id: string } | null)?.id;
  if (!setId) {
    return [];
  }

  // Paged for the same max_rows reason as the sku query below. Real sets top
  // out in the hundreds of printings, so this is normally a single request.
  const printingIds: string[] = [];
  for (let offset = 0; ; offset += SKU_PAGE_SIZE) {
    const page = await withRetry(() =>
      supabase
        .from("card_printings")
        .select("id")
        .eq("set_id", setId)
        .range(offset, offset + SKU_PAGE_SIZE - 1)
        .returns<{ id: string }[]>(),
    );

    if (page.error) {
      throw new Error(`Failed to list set cards: ${page.error.message}`);
    }

    const rows = page.data ?? [];
    printingIds.push(...rows.map((row) => row.id));

    if (rows.length < SKU_PAGE_SIZE) {
      break;
    }
  }

  return printingIds;
}

// Paginated instead of a single unpaginated query (see SKU_PAGE_SIZE above).
// The first page asks Postgrest for an exact count alongside its rows, which
// tells us how many more pages exist -- letting every page after the first
// be fetched in parallel instead of one at a time. For a set like Modern
// Horizons 3 (~5,000 active skus, 5 pages) that's the difference between 5
// sequential round trips and 2 (first page, then the rest concurrently).
async function fetchSkuRowsForPrintings(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  printingIds: string[],
): Promise<SkuSelectRow[]> {
  function buildPage(offset: number, withCount: boolean) {
    return supabase
      .from("sellable_skus")
      .select(SKU_SELECT_COLUMNS, withCount ? { count: "exact" } : undefined)
      .in("card_printing_id", printingIds)
      .eq("product_statuses.code", "active")
      .range(offset, offset + SKU_PAGE_SIZE - 1)
      .returns<SkuSelectRow[]>();
  }

  const first = await withRetry(() => buildPage(0, true));
  if (first.error) {
    throw new Error(`Failed to list set cards: ${first.error.message}`);
  }

  const rows: SkuSelectRow[] = [...(first.data ?? [])];
  const total = first.count ?? rows.length;

  const remainingOffsets: number[] = [];
  for (let offset = SKU_PAGE_SIZE; offset < total; offset += SKU_PAGE_SIZE) {
    remainingOffsets.push(offset);
  }

  if (remainingOffsets.length > 0) {
    const restPages = await runWithConcurrencyLimit(
      remainingOffsets.map((offset) => () => withRetry(() => buildPage(offset, false))),
      MAX_CONCURRENT_REQUESTS,
    );
    for (const page of restPages) {
      if (page.error) {
        throw new Error(`Failed to list set cards: ${page.error.message}`);
      }
      rows.push(...(page.data ?? []));
    }
  }

  return rows;
}

async function fetchAllSkuRows(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  setCode: string,
): Promise<SkuSelectRow[]> {
  const printingIds = await fetchSetPrintingIds(supabase, setCode);

  if (printingIds.length === 0) {
    return [];
  }

  // Chunked for the same reason as the image/price/balance lookups below:
  // an `in` list becomes part of the request URL, so it has a practical
  // ceiling. Real sets sit well inside one chunk; the loop is here so a
  // hypothetical huge set degrades into extra requests rather than a
  // truncated result.
  const chunks: string[][] = [];
  for (let index = 0; index < printingIds.length; index += ID_BATCH_SIZE) {
    chunks.push(printingIds.slice(index, index + ID_BATCH_SIZE));
  }

  const chunkResults = await runWithConcurrencyLimit(
    chunks.map((chunk) => () => fetchSkuRowsForPrintings(supabase, chunk)),
    MAX_CONCURRENT_REQUESTS,
  );

  return chunkResults.flat();
}

export async function listSetCards(
  setCode: string,
  options: ListSetCardsOptions = {},
): Promise<SetCardRow[]> {
  const supabase = await createServerSupabaseClient();

  const skuRows = await fetchAllSkuRows(supabase, setCode);

  const rows: SkuRow[] = (skuRows ?? []).map((row) => {
    const printing = single(row.card_printings);
    const oracle = single(printing.oracle_cards);

    return {
      sku_id: row.id,
      card_printing_id: row.card_printing_id,
      finish_code: single(row.finishes).code,
      printing_id: printing.id,
      rarity: printing.rarity,
      collector_number: printing.collector_number,
      border_color: printing.border_color,
      name: oracle.name,
      type_line: oracle.type_line,
      colors: oracle.colors,
    };
  });

  if (rows.length === 0) {
    return [];
  }

  const finishFilter = onlyKnown(options.finishes, CARD_FINISHES);
  const colorFilter = onlyKnown(options.colors, CARD_COLORS);
  const borderColorFilter = onlyKnown(options.borderColors, CARD_BORDER_COLORS);

  const finishFilterSet = new Set<string>(finishFilter);
  const borderColorFilterSet = new Set<string>(borderColorFilter);

  const filteredRows = rows.filter(
    (row) =>
      (finishFilterSet.size === 0 || finishFilterSet.has(row.finish_code)) &&
      matchesColorFilter(row.colors, colorFilter) &&
      (borderColorFilterSet.size === 0 ||
        (row.border_color != null && borderColorFilterSet.has(row.border_color))),
  );

  if (filteredRows.length === 0) {
    return [];
  }

  const printingIds = new Set(filteredRows.map((row) => row.printing_id));
  const skuIds = filteredRows.map((r) => r.sku_id);
  const printingIdBatches = chunk(Array.from(printingIds), ID_BATCH_SIZE);
  const skuIdBatches = chunk(skuIds, ID_BATCH_SIZE);

  type LookupResult = { data: unknown[] | null; error: { message: string } | null };
  type ImageRow = { card_printing_id: string; url: string };
  type PriceRow = { sellable_sku_id: string; final_amount: number; currency: string };
  type BalanceRow = { sellable_sku_id: string; quantity_available_online: number };

  // All three categories' chunk requests share one concurrency-limited pool
  // rather than each firing its own batch of parallel requests -- three
  // uncoordinated Promise.all groups can still add up to more simultaneous
  // requests than the network can reliably hold open at once.
  const imageTaskCount = printingIdBatches.length;
  const priceTaskCount = skuIdBatches.length;

  const allResults = await runWithConcurrencyLimit<LookupResult>(
    [
      ...printingIdBatches.map(
        (batch) => () =>
          withRetry(() =>
            supabase
              .from("card_images")
              .select("card_printing_id, url")
              .in("card_printing_id", batch)
              .eq("image_type", "normal")
              .eq("face", "front"),
          ),
      ),
      ...skuIdBatches.map(
        (batch) => () =>
          withRetry(() =>
            supabase
              .from("published_prices")
              .select("sellable_sku_id, final_amount, currency")
              .in("sellable_sku_id", batch)
              .eq("status", "active"),
          ),
      ),
      ...skuIdBatches.map(
        (batch) => () =>
          withRetry(() =>
            supabase
              .from("inventory_balances")
              .select("sellable_sku_id, quantity_available_online")
              .in("sellable_sku_id", batch),
          ),
      ),
    ],
    MAX_CONCURRENT_REQUESTS,
  );

  const imageResults = allResults.slice(0, imageTaskCount) as {
    data: ImageRow[] | null;
    error: { message: string } | null;
  }[];
  const priceResults = allResults.slice(imageTaskCount, imageTaskCount + priceTaskCount) as {
    data: PriceRow[] | null;
    error: { message: string } | null;
  }[];
  const balanceResults = allResults.slice(imageTaskCount + priceTaskCount) as {
    data: BalanceRow[] | null;
    error: { message: string } | null;
  }[];

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
    borderColor: string | null;
    imageUrl: string | null;
    totalAvailable: number;
    bestPrice: { amount: number; currency: string; skuId: string } | null;
    fallbackSkuId: string;
  };

  const groups = new Map<string, Group>();

  for (const row of filteredRows) {
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
        borderColor: row.border_color,
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
      borderColor: group.borderColor,
      representativeSkuId: group.bestPrice?.skuId ?? group.fallbackSkuId,
      price: group.bestPrice?.amount ?? null,
      currency: group.bestPrice?.currency ?? null,
      availableQuantity: group.totalAvailable,
      imageUrl: group.imageUrl,
    }));

  result.sort(buildComparator(options.sort));

  return result.slice(0, MAX_RESULT_ROWS);
}

function byNameThenFinish(a: SetCardRow, b: SetCardRow): number {
  return a.name.localeCompare(b.name) || a.finishCode.localeCompare(b.finishCode);
}

// Rows with no active price sort last regardless of direction -- a missing
// price isn't meaningfully "cheap" or "expensive".
function buildComparator(sort: string | undefined): (a: SetCardRow, b: SetCardRow) => number {
  switch (sort) {
    case "price-desc":
      return (a, b) => {
        if (a.price == null) return b.price == null ? byNameThenFinish(a, b) : 1;
        if (b.price == null) return -1;
        return b.price - a.price || byNameThenFinish(a, b);
      };
    case "price-asc":
      return (a, b) => {
        if (a.price == null) return b.price == null ? byNameThenFinish(a, b) : 1;
        if (b.price == null) return -1;
        return a.price - b.price || byNameThenFinish(a, b);
      };
    case "name-asc":
    default:
      return byNameThenFinish;
  }
}
