import type { Sql } from "postgres";

// Cross-product SKU generation (backlog B-051): a sellable SKU is exact
// printing + language + finish + condition. Only English is generated for
// now — the MTGJSON per-set files this importer reads (see
// integrations/mtgjson/types.ts) carry no per-printing foreign-language
// availability data, so generating the full `languages` reference table's
// cross product would invent SKUs for languages a printing was never
// released in. Expand this once foreign-language import data lands.
const DEFAULT_LANGUAGE_CODE = "en";
const ACTIVE_STATUS_CODE = "active";

export type GenerateSkusResult = {
  skusInserted: number;
};

// Scoped to the given printing ids only — the caller (the catalogue-import
// consumer) passes exactly the printings a single import run touched, so
// this never rewrites the full sellable_skus table (backlog B-051 "new/
// changed printings only, incremental" AC). SKU ids are deterministic
// (see the sellable_skus migration), so `on conflict do nothing` against
// the natural-key unique constraint makes re-running this for the same
// printing a no-op rather than a duplicate insert.
export async function generateSkusForPrintings(
  sql: Sql,
  printingIds: string[],
): Promise<GenerateSkusResult> {
  if (printingIds.length === 0) {
    return { skusInserted: 0 };
  }

  const inserted = await sql<{ id: string }[]>`
    with target_printings as (
      select id, finishes from card_printings where id = any(${printingIds})
    ),
    expanded as (
      select
        tp.id as card_printing_id,
        finish_code
      from target_printings tp, unnest(tp.finishes) as finish_code
    )
    insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
    select
      e.card_printing_id,
      (select id from languages where code = ${DEFAULT_LANGUAGE_CODE}),
      f.id,
      c.id,
      (select id from product_statuses where code = ${ACTIVE_STATUS_CODE})
    from expanded e
    join finishes f on f.code = e.finish_code
    cross join conditions c
    on conflict (card_printing_id, language_id, finish_id, condition_id) do nothing
    returning id
  `;

  return { skusInserted: inserted.length };
}
