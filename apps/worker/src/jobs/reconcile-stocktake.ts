import type { Sql } from "postgres";

const ADJUSTMENT_MOVEMENT_TYPE = "stocktake_adjustment";

export type ReconcileStocktakeResult = {
  linesReconciled: number;
  adjustmentsWritten: number;
};

type StocktakeLine = {
  id: string;
  fulfilment_node_id: string;
  sellable_sku_id: string;
  counted_quantity: number;
  variance: number;
};

// Turns a completed stocktake's counted lines into inventory_movements
// (backlog B-065): every non-zero variance goes through adjust_inventory()
// (backlog B-061) -- this worker connects directly to Postgres with no
// staff JWT, which adjust_inventory()'s is_trusted_backend_connection()
// check exists specifically to allow, rather than editing
// inventory_balances directly here. A zero-variance line is marked
// reconciled with no movement (nothing to adjust). Safe to re-run: already
// -reconciled lines are excluded from the update, so a retry after a
// partial failure only processes what's left.
export async function reconcileStocktake(
  sql: Sql,
  stocktakeId: string,
): Promise<ReconcileStocktakeResult> {
  const [stocktake] = await sql<{ id: string }[]>`
    select id from stocktakes where id = ${stocktakeId}
  `;
  if (!stocktake) {
    throw new Error(`reconcileStocktake: unknown stocktake ${stocktakeId}`);
  }

  const lines = await sql<StocktakeLine[]>`
    select id, fulfilment_node_id, sellable_sku_id, counted_quantity, variance
    from stocktake_lines
    where stocktake_id = ${stocktakeId}
      and reconciled = false
      and counted_quantity is not null
  `;

  let adjustmentsWritten = 0;

  for (const line of lines) {
    if (line.variance === 0) {
      await sql`
        update stocktake_lines set reconciled = true, updated_at = now() where id = ${line.id}
      `;
      continue;
    }

    const [movement] = await sql<{ id: string }[]>`
      select id from adjust_inventory(
        ${line.fulfilment_node_id}::uuid,
        ${line.sellable_sku_id}::uuid,
        ${ADJUSTMENT_MOVEMENT_TYPE},
        ${line.variance}::integer,
        ${"stocktake recount variance"}::text,
        ${"stocktake_line"}::text,
        ${line.id}::uuid
      )
    `;

    await sql`
      update stocktake_lines
      set reconciled = true, adjustment_movement_id = ${movement.id}, updated_at = now()
      where id = ${line.id}
    `;
    adjustmentsWritten += 1;
  }

  const [{ unreconciled }] = await sql<{ unreconciled: string }[]>`
    select count(*) as unreconciled
    from stocktake_lines
    where stocktake_id = ${stocktakeId} and reconciled = false and counted_quantity is not null
  `;

  if (Number(unreconciled) === 0) {
    await sql`
      update stocktakes set status = 'reconciled', reconciled_at = now(), updated_at = now()
      where id = ${stocktakeId} and status <> 'reconciled'
    `;
  }

  return { linesReconciled: lines.length, adjustmentsWritten };
}
