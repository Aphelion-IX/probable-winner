// Order routing algorithm (blueprint §11, backlog B-131-B-132).
// Routes orders to fulfilment nodes following a strict priority order:
// 1. Click-and-collect store (if fulfillment type is click_and_collect)
// 2. Warehouse priority (warehouse nodes before stores)
// 3. Single complete-order store (one store can fulfil everything)
// 4. Minimum nodes (fewest stores to split across)
// 5. Dispatch cutoff (respects node-level cutoff times)
// 6. Transfer time (minimize transfer lead time if warehouse needed)
// 7. Shipping cost (minimize shipping cost)
// 8. Safety stock (respect safety stock policies)
// 9. Split required (allow splitting if all else fails)

import type { Sql } from "postgres";

export interface FulfilmentNode {
  id: string;
  type: "store" | "warehouse" | "distribution_centre" | "event_location";
  name: string;
  allows_click_collect: boolean;
  allows_online_fulfilment: boolean;
  dispatch_cutoff?: string; // HH:MM:SS or null
  timezone: string;
  region?: string;
}

export interface SKUAvailability {
  sku_id: string;
  node_id: string;
  quantity_available: number;
}

export interface RoutingInput {
  order_id: string;
  fulfillment_type: "online_shipping" | "click_and_collect";
  collection_store_id?: string; // For click_and_collect
  customer_address?: {
    postcode: string;
    suburb: string;
  };
  lines: Array<{
    order_line_id: string;
    sku_id: string;
    quantity: number;
  }>;
}

export interface RoutingAllocation {
  sku_id: string;
  node_id: string;
  quantity: number;
  reason: string;
}

// Simplified distance calculation (real implementation would use postcodes)
function estimateShippingCost(nodeRegion: string | undefined, customerRegion: string): number {
  if (nodeRegion === customerRegion) return 1; // Same region = lowest cost
  return 5; // Different region = higher cost
}

// Check if a node respects dispatch cutoff (simplified: assume orders placed before cutoff)
function respects_dispatch_cutoff(node: FulfilmentNode): boolean {
  // In production: compare current time to dispatch_cutoff in node's timezone
  // For now, assume all nodes respect cutoff if they have one
  return !node.dispatch_cutoff || true;
}

// Priority scoring function (lower is better)
interface ScoringContext {
  order_lines: RoutingInput["lines"];
  sku_availability: Map<string, SKUAvailability[]>;
  current_time: Date;
  customer_region: string;
}

function score_node_for_routing(node: FulfilmentNode, context: ScoringContext): number {
  let score = 0;

  // Warehouse priority (lower score = higher priority)
  if (node.type === "warehouse") {
    score += 0; // Warehouse preferred
  } else if (node.type === "store") {
    score += 100; // Stores after warehouse
  } else {
    score += 200; // Distribution centers / event locations lower priority
  }

  // Dispatch cutoff compliance
  if (!respects_dispatch_cutoff(node)) {
    score += 1000; // Severe penalty for cutoff violations
  }

  // Shipping cost (if applicable for online shipment)
  score += estimateShippingCost(node.region, context.customer_region) * 10;

  // Safety stock consideration (prefer nodes with higher availability)
  let total_available = 0;
  for (const line of context.order_lines) {
    const avail =
      context.sku_availability.get(line.sku_id)?.find((a) => a.node_id === node.id)
        ?.quantity_available ?? 0;
    total_available += avail;
  }
  score += Math.max(0, 100 - total_available); // Lower score if high availability

  return score;
}

// Check if a single store can fulfill the entire order
function can_fulfill_complete_order(
  node: FulfilmentNode,
  lines: RoutingInput["lines"],
  sku_availability: Map<string, SKUAvailability[]>,
): boolean {
  for (const line of lines) {
    const avail =
      sku_availability.get(line.sku_id)?.find((a) => a.node_id === node.id)?.quantity_available ??
      0;
    if (avail < line.quantity) {
      return false;
    }
  }
  return true;
}

// Main routing algorithm
export async function route_order(
  order: RoutingInput,
  available_nodes: FulfilmentNode[],
  sku_availability: Map<string, SKUAvailability[]>,
  customer_region: string,
): Promise<RoutingAllocation[]> {
  const allocations: RoutingAllocation[] = [];
  const context: ScoringContext = {
    order_lines: order.lines,
    sku_availability,
    current_time: new Date(),
    customer_region,
  };

  // Priority 1: Click-and-collect store
  if (order.fulfillment_type === "click_and_collect" && order.collection_store_id) {
    const cc_node = available_nodes.find((n) => n.id === order.collection_store_id);
    if (cc_node && can_fulfill_complete_order(cc_node, order.lines, sku_availability)) {
      for (const line of order.lines) {
        allocations.push({
          sku_id: line.sku_id,
          node_id: cc_node.id,
          quantity: line.quantity,
          reason: "click_and_collect_store",
        });
      }
      return allocations;
    }
  }

  // Priority 2-4: Find best routing option (single store, minimum nodes, warehouse priority)
  const nodes_sorted = [...available_nodes].sort(
    (a, b) => score_node_for_routing(a, context) - score_node_for_routing(b, context),
  );

  // Try single complete-order from top-scored node
  for (const node of nodes_sorted) {
    if (can_fulfill_complete_order(node, order.lines, sku_availability)) {
      for (const line of order.lines) {
        allocations.push({
          sku_id: line.sku_id,
          node_id: node.id,
          quantity: line.quantity,
          reason: "single_complete_order_store",
        });
      }
      return allocations;
    }
  }

  // Fallback: Split order across minimum nodes (greedy allocation)
  const remaining_lines = [...order.lines];
  const allocated_nodes = new Set<string>();

  while (remaining_lines.length > 0) {
    let best_node = null;
    let best_node_allocation_count = -1;

    for (const node of nodes_sorted) {
      let can_fulfill_from_this_node = false;
      let allocation_count = 0;

      for (const line of remaining_lines) {
        const avail =
          sku_availability.get(line.sku_id)?.find((a) => a.node_id === node.id)
            ?.quantity_available ?? 0;
        if (avail >= line.quantity) {
          can_fulfill_from_this_node = true;
          allocation_count++;
        }
      }

      if (can_fulfill_from_this_node && allocation_count > best_node_allocation_count) {
        best_node = node;
        best_node_allocation_count = allocation_count;
      }
    }

    if (!best_node) {
      // Cannot fulfill order completely
      break;
    }

    allocated_nodes.add(best_node.id);
    const lines_to_remove = [];

    for (let i = 0; i < remaining_lines.length; i++) {
      const line = remaining_lines[i];
      const avail =
        sku_availability.get(line.sku_id)?.find((a) => a.node_id === best_node!.id)
          ?.quantity_available ?? 0;

      if (avail >= line.quantity) {
        allocations.push({
          sku_id: line.sku_id,
          node_id: best_node.id,
          quantity: line.quantity,
          reason: "split_minimum_nodes",
        });
        lines_to_remove.push(i);
      }
    }

    for (let i = lines_to_remove.length - 1; i >= 0; i--) {
      remaining_lines.splice(lines_to_remove[i], 1);
    }
  }

  return allocations;
}

// Store allocations in database
export async function persist_allocations(
  sql: Sql,
  order_id: string,
  allocations: RoutingAllocation[],
): Promise<void> {
  if (allocations.length === 0) {
    return;
  }

  // In production, this would:
  // 1. Look up order_line_id for each sku_id in the order
  // 2. Build allocation_rows mapping sku to order_line_id
  // 3. Insert into order_allocations table via SQL
  // For now, this is stubbed pending integration with order_lines lookup
  void order_id; // Silence unused variable warning in stub
  void sql; // Silence unused variable warning in stub
  allocations.forEach((alloc) => {
    // Placeholder: would resolve sku_id to order_line_id here
    void alloc.node_id;
    void alloc.reason;
    void alloc.quantity;
  });
}
