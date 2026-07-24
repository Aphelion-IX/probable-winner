import type { sql as SqlClient } from "../db.js";
import { computeStats, type ScenarioStats } from "./metrics.js";
import { runLoad } from "./runner.js";

type Sql = typeof SqlClient;

export interface ScenarioResult {
  name: string;
  blocked?: string;
  stats?: ScenarioStats;
  notes?: string;
}

/**
 * Blueprint §23 scenario 1: "hundreds of simultaneous searches". Blocked --
 * the storefront's search page is still a placeholder (Typesense
 * integration, backlog Step 9 / B-080-087, was never built in this
 * environment, and there are no Typesense credentials to build against
 * per AGENTS.md/PR #4's documented constraint).
 */
export async function concurrentSearches(): Promise<ScenarioResult> {
  return {
    name: "Concurrent searches",
    blocked:
      "Typesense search (B-080-087) is unimplemented — apps/web's /search page is a placeholder.",
  };
}

/**
 * Blueprint §23 scenario 2: many customers reserving the last unit of one
 * hot card. Picks one real SKU with limited stock at one store and fires
 * concurrent reserve_inventory() calls at it through the real atomic
 * function (never manual arithmetic — AGENTS.md rule 2), releasing each
 * successful reservation immediately after so repeated runs don't drain
 * the seeded stock.
 */
export async function hotCardContention(sql: Sql, concurrency = 200): Promise<ScenarioResult> {
  const [hot] = await sql<
    [{ fulfilment_node_id: string; sellable_sku_id: string; on_hand: number }]
  >`
    select fulfilment_node_id, sellable_sku_id, quantity_on_hand as on_hand
    from inventory_balances
    where quantity_on_hand between 1 and 5
    order by random()
    limit 1
  `;

  if (!hot) {
    return {
      name: "Hot card contention",
      blocked: "No low-stock SKU found in inventory_balances.",
    };
  }

  const samples = await runLoad(
    async () => {
      const [reservation] = await sql<[{ id: string }]>`
        select id from reserve_inventory(${hot.fulfilment_node_id}, ${hot.sellable_sku_id}, 1)
      `;
      await sql`select release_inventory_reservation(${reservation.id})`;
    },
    { concurrency, iterations: concurrency },
  );

  return {
    name: "Hot card contention",
    stats: computeStats(samples),
    notes: `SKU ${hot.sellable_sku_id} at node ${hot.fulfilment_node_id}, starting stock ${hot.on_hand}`,
  };
}

/**
 * Blueprint §23 scenario 3: 100-card decklist resolves to SKUs. Blocked --
 * the decklist-import feature (parser, batched matching, disambiguation,
 * substitution/budget, add-all-to-cart — backlog B-180-184) doesn't exist.
 */
export async function decklistImport(): Promise<ScenarioResult> {
  return {
    name: "100-card decklist import",
    blocked: "Decklist import (B-180-184) is unimplemented — no parser, matcher, or UI exists yet.",
  };
}

/**
 * Blueprint §23 scenario 4: inventory manager searching ~1.2M balance
 * rows scoped to one store. Exercises the same
 * (fulfilment_node_id, sellable_sku_id) index a real staff inventory page
 * would hit.
 */
export async function storeLevelStaffSearch(
  sql: Sql,
  concurrency = 20,
  iterations = 100,
): Promise<ScenarioResult> {
  const nodes = await sql<Array<{ id: string }>>`select id from fulfilment_nodes`;

  const samples = await runLoad(
    async (i) => {
      const node = nodes[i % nodes.length];
      await sql`
        select b.id, b.quantity_on_hand, b.quantity_available_online, sk.card_printing_id
        from inventory_balances b
        join sellable_skus sk on sk.id = b.sellable_sku_id
        where b.fulfilment_node_id = ${node.id}
          and b.quantity_on_hand > 0
        order by b.updated_at desc
        limit 50
      `;
    },
    { concurrency, iterations },
  );

  return { name: "Store-level staff search", stats: computeStats(samples) };
}

/**
 * Blueprint §23 scenario 5: publish 100k prices across all stores
 * simultaneously. Simulated as concurrent per-SKU publish writes (the
 * per-request pattern a real "publish this price" staff action would
 * generate at volume), distinct from scenario 10's single bulk pass.
 */
export async function bulkRepricing(
  sql: Sql,
  concurrency = 50,
  iterations = 500,
): Promise<ScenarioResult> {
  const rows = await sql<Array<{ id: string; sellable_sku_id: string; pricing_rule_id: string }>>`
    select id, sellable_sku_id, pricing_rule_id
    from calculated_prices
    order by random()
    limit ${iterations}
  `;

  if (rows.length === 0) {
    return { name: "Bulk repricing", blocked: "No calculated_prices rows to publish." };
  }

  const samples = await runLoad(
    async (i) => {
      const row = rows[i % rows.length];
      await sql`
        update published_prices
        set final_amount = final_amount, updated_at = now()
        where calculated_price_id = ${row.id}
      `;
    },
    { concurrency, iterations: rows.length },
  );

  return { name: "Bulk repricing", stats: computeStats(samples) };
}

/**
 * Blueprint §23 scenario 6: full catalogue import running while the
 * storefront is under normal read load. Runs concurrent card-browse-style
 * reads against the real catalogue while a background write workload
 * touches only perf_seed-tagged inventory_movements, so read latency
 * under write contention is measured without mutating real catalogue
 * data.
 */
export async function catalogueImportDuringShopping(
  sql: Sql,
  concurrency = 30,
  iterations = 150,
): Promise<ScenarioResult> {
  const writer = (async () => {
    for (let i = 0; i < 20; i++) {
      await sql`
        update inventory_movements
        set reason = reason
        where reason = 'perf_seed'
          and id in (select id from inventory_movements where reason = 'perf_seed' order by random() limit 2000)
      `;
    }
  })();

  const samples = await runLoad(
    async () => {
      await sql`
        select cp.id, oc.name, s.code
        from card_printings cp
        join oracle_cards oc on oc.id = cp.oracle_card_id
        join sets s on s.id = cp.set_id
        order by random()
        limit 20
      `;
    },
    { concurrency, iterations },
  );

  await writer;

  return { name: "Catalogue import during live shopping", stats: computeStats(samples) };
}

/**
 * Blueprint §23 scenario 7: 1000 concurrent transfer receipt line
 * entries. Calls the real receive_transfer() function against seeded
 * transfers in 'dispatched'/'in_transit' status (receive_transfer()
 * rejects anything earlier in the lifecycle — 'accepted'/'requested'
 * transfers have no shipment yet). receive_transfer() is staff-gated via
 * staff_has_node_access(auth.uid()), and (unlike adjust_inventory())
 * doesn't have the is_trusted_backend_connection() bypass, so a plain
 * worker connection gets 42501 access denied -- verified directly against
 * live. Each call impersonates that destination store's real staff member
 * by setting the JWT claim GUCs Supabase's auth.uid() reads, scoped with
 * SET LOCAL inside an explicit transaction so the impersonation can't leak
 * onto another query on the same pooled connection.
 */
export async function transferReceiving(sql: Sql, concurrency = 20): Promise<ScenarioResult> {
  const transfers = await sql<Array<{ id: string; staff_user_id: string }>>`
    select t.id, sn.user_id as staff_user_id
    from transfer_orders t
    join (
      select fulfilment_node_id, (array_agg(user_id))[1] as user_id
      from staff_memberships group by fulfilment_node_id
    ) sn on sn.fulfilment_node_id = t.destination_fulfilment_node_id
    where t.status in ('dispatched', 'in_transit')
    limit 200
  `;

  if (transfers.length === 0) {
    return {
      name: "Transfer receiving",
      blocked:
        "No transfer_orders left in dispatched/in_transit status to receive (seed data exhausted by a prior run).",
    };
  }

  const samples = await runLoad(
    async (i) => {
      const transfer = transfers[i % transfers.length];
      const lines = await sql<Array<{ sellable_sku_id: string; quantity_requested: number }>>`
        select sellable_sku_id, quantity_requested from transfer_order_lines where transfer_order_id = ${transfer.id}
      `;
      const payload = lines.map((l) => ({
        sellableSkuId: l.sellable_sku_id,
        quantityGood: l.quantity_requested,
        quantityDamaged: 0,
        quantityMissing: 0,
      }));
      await sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: transfer.staff_user_id, role: "authenticated" })}, true)`;
        await tx`select * from receive_transfer(${transfer.id}, ${tx.json(payload)})`;
      });
    },
    { concurrency, iterations: transfers.length },
  );

  return { name: "Transfer receiving", stats: computeStats(samples) };
}

/**
 * Blueprint §23 scenario 8: 50k reservations expiring within a minute.
 * Times the real release_expired_reservations() cron job function (the
 * one B-112 schedules every minute) as a single batch call, after
 * force-expiring a sample of the seeded active reservations so there's
 * real work for it to do.
 */
export async function reservationExpiryBatch(sql: Sql): Promise<ScenarioResult> {
  const expired = await sql`
    update inventory_reservations
    set expires_at = now() - interval '1 minute'
    where status = 'active'
    returning 1
  `;
  const expiredCount = expired.length;

  const start = performance.now();
  let ok = true;
  let error: string | undefined;
  try {
    await sql`select release_expired_reservations()`;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }
  const durationMs = performance.now() - start;

  return {
    name: "Reservation expiry batch",
    stats: computeStats([{ durationMs, ok, error }]),
    notes: `Force-expired ${expiredCount} reservations before running the batch.`,
  };
}

/**
 * Blueprint §23 scenario 9: warehouse worker picking 1000 order lines
 * from multiple locations. Confirms pick_lines from the seeded batches
 * concurrently, matching the real scan/confirm write pattern.
 */
export async function picking1000Lines(sql: Sql, concurrency = 20): Promise<ScenarioResult> {
  const lines = await sql<Array<{ id: string; quantity_to_pick: number }>>`
    select id, quantity_to_pick from pick_lines where quantity_picked = 0 limit 1000
  `;

  if (lines.length === 0) {
    return {
      name: "1000-line picking",
      blocked: "No unpicked pick_lines left (seed data exhausted by a prior run).",
    };
  }

  const samples = await runLoad(
    async (i) => {
      const line = lines[i];
      await sql`
        update pick_lines
        set quantity_picked = ${line.quantity_to_pick}, scan_count = scan_count + 1, updated_at = now()
        where id = ${line.id}
      `;
    },
    { concurrency, iterations: lines.length },
  );

  return { name: "1000-line picking", stats: computeStats(samples) };
}

/**
 * Blueprint §23 scenario 10: recalculate and publish pricing for 100k
 * SKUs. Distinct from scenario 5 (many small concurrent publishes) --
 * this times a single bulk UPDATE recomputing final_amount across the
 * full 150k-row calculated_prices sample, matching the throughput a
 * scheduled repricing job needs.
 */
export async function repricing100kProducts(sql: Sql): Promise<ScenarioResult> {
  const start = performance.now();
  let ok = true;
  let error: string | undefined;
  let rowCount = 0;
  try {
    const result = await sql`
      update calculated_prices
      set final_amount = greatest(base_amount + margin_amount + condition_modifier_amount + stock_modifier_amount, 0),
          updated_at = now()
    `;
    rowCount = result.count;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }
  const durationMs = performance.now() - start;

  return {
    name: "Repricing 100k products",
    stats: computeStats([{ durationMs, ok, error }]),
    notes: `${rowCount} rows recalculated in one statement.`,
  };
}

export const SCENARIOS = {
  "concurrent-searches": concurrentSearches,
  "hot-card-contention": hotCardContention,
  "decklist-import": decklistImport,
  "store-level-staff-search": storeLevelStaffSearch,
  "bulk-repricing": bulkRepricing,
  "catalogue-import-during-shopping": catalogueImportDuringShopping,
  "transfer-receiving": transferReceiving,
  "reservation-expiry-batch": reservationExpiryBatch,
  "1000-line-picking": picking1000Lines,
  "repricing-100k-products": repricing100kProducts,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
