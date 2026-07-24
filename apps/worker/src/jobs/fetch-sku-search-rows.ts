import type { Sql } from "postgres";

// Batched read model backing both the full Typesense reindex (B-081) and
// the incremental single-SKU update (B-083): one query joining every table
// a search document needs, optionally scoped to a specific set of SKU ids.
// Never one query per SKU — the same batching principle as
// match-decklist-lines.ts (blueprint §20).

export type SkuSearchRow = {
  skuId: string;
  oracleCardId: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  cmc: number | null;
  colorIdentity: string[];
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  artistName: string | null;
  imageUrl: string | null;
  finishCode: string;
  conditionCode: string;
  languageCode: string;
  legality: Record<string, string>;
  priceAmount: number | null;
  priceCurrency: string | null;
  quantityAvailable: number;
  quantityInStores: Record<string, number>;
};

type SkuSearchRowSql = {
  sku_id: string;
  oracle_card_id: string;
  name: string;
  type_line: string;
  mana_cost: string | null;
  cmc: string | null;
  color_identity: string[];
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  artist_name: string | null;
  image_url: string | null;
  finish_code: string;
  condition_code: string;
  language_code: string;
  legality: Record<string, string> | null;
  price_amount: string | null;
  price_currency: string | null;
  quantity_available: string;
  quantity_in_stores: Record<string, number> | null;
};

export async function fetchSkuSearchRows(sql: Sql, skuIds?: string[]): Promise<SkuSearchRow[]> {
  const rows = await sql<SkuSearchRowSql[]>`
    with images as (
      select distinct on (card_printing_id) card_printing_id, url
      from card_images
      order by card_printing_id,
        case image_type
          when 'normal' then 0
          when 'large' then 1
          when 'small' then 2
          else 3
        end
    ),
    legalities as (
      select cl.oracle_card_id, jsonb_object_agg(fmt.code, cl.status) as legality
      from card_legalities cl
      join formats fmt on fmt.id = cl.format_id
      group by cl.oracle_card_id
    ),
    prices as (
      select sellable_sku_id, final_amount, currency
      from published_prices
      where status = 'active'
    ),
    balances as (
      select
        sellable_sku_id,
        sum(quantity_available_online) as total_available,
        jsonb_object_agg(fulfilment_node_id, quantity_available_online)
          filter (where quantity_available_online > 0) as by_store
      from inventory_balances
      group by sellable_sku_id
    )
    select
      sk.id as sku_id,
      cp.oracle_card_id,
      oc.name,
      oc.type_line,
      oc.mana_cost,
      oc.cmc,
      oc.color_identity,
      s.code as set_code,
      s.name as set_name,
      cp.collector_number,
      cp.rarity,
      a.name as artist_name,
      images.url as image_url,
      f.code as finish_code,
      c.code as condition_code,
      lang.code as language_code,
      legalities.legality,
      prices.final_amount as price_amount,
      prices.currency as price_currency,
      coalesce(balances.total_available, 0) as quantity_available,
      coalesce(balances.by_store, '{}'::jsonb) as quantity_in_stores
    from sellable_skus sk
    join card_printings cp on cp.id = sk.card_printing_id
    join oracle_cards oc on oc.id = cp.oracle_card_id
    join sets s on s.id = cp.set_id
    left join artists a on a.id = cp.artist_id
    left join images on images.card_printing_id = cp.id
    join finishes f on f.id = sk.finish_id
    join conditions c on c.id = sk.condition_id
    join languages lang on lang.id = sk.language_id
    join product_statuses ps on ps.id = sk.product_status_id
    left join legalities on legalities.oracle_card_id = cp.oracle_card_id
    left join prices on prices.sellable_sku_id = sk.id
    left join balances on balances.sellable_sku_id = sk.id
    where ps.code = 'active'
      ${skuIds ? sql`and sk.id = any(${skuIds})` : sql``}
  `;

  return rows.map((row) => ({
    skuId: row.sku_id,
    oracleCardId: row.oracle_card_id,
    name: row.name,
    typeLine: row.type_line,
    manaCost: row.mana_cost,
    cmc: row.cmc === null ? null : Number(row.cmc),
    colorIdentity: row.color_identity,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    artistName: row.artist_name,
    imageUrl: row.image_url,
    finishCode: row.finish_code,
    conditionCode: row.condition_code,
    languageCode: row.language_code,
    legality: row.legality ?? {},
    priceAmount: row.price_amount === null ? null : Number(row.price_amount),
    priceCurrency: row.price_currency,
    quantityAvailable: Number(row.quantity_available),
    quantityInStores: row.quantity_in_stores ?? {},
  }));
}
