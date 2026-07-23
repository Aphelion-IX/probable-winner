"use server";

import { createServerSupabaseClient } from "@/server/supabase";

export interface PickLineItem {
  id: string;
  order_line_id: string;
  allocation_id: string;
  sku_id: string;
  quantity_to_pick: number;
  quantity_picked: number;
  condition_confirmed: string | null;
  scan_count: number;
  sort_order: number;
  order_number: string;
  card_name: string;
  set_code: string;
  collector_number: string;
  language: string;
  finish: string;
  expected_condition: string;
}

export interface PickBatchDetail {
  id: string;
  fulfilment_node_id: string;
  node_name: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  pick_lines: PickLineItem[];
  total_lines: number;
  completed_lines: number;
  total_items: number;
  picked_items: number;
}

interface PickLineRow {
  id: string;
  order_line_id: string;
  allocation_id: string;
  sku_id: string;
  quantity_to_pick: number;
  quantity_picked: number;
  condition_confirmed: string | null;
  scan_count: number;
  sort_order: number;
}

interface LineDetail {
  id: string;
  orders: { order_number: string } | null;
  sellable_skus: {
    languages: { code: string } | null;
    finishes: { name: string } | null;
    conditions: { name: string } | null;
    card_printing: {
      oracle_card: { name: string } | null;
      set: { code: string } | null;
      collector_number: string;
    } | null;
  } | null;
}

interface BatchFulfilmentNode {
  name: string;
}

export async function getPickBatch(batchId: string): Promise<PickBatchDetail> {
  const supabase = createServerSupabaseClient();

  const { data: batch, error: batchError } = await supabase
    .from("pick_batches")
    .select(
      `
      id,
      fulfilment_node_id,
      fulfillment_node:fulfilment_nodes(name),
      status,
      created_at,
      started_at,
      completed_at,
      pick_lines(
        id,
        order_line_id,
        allocation_id,
        sku_id,
        quantity_to_pick,
        quantity_picked,
        condition_confirmed,
        scan_count,
        sort_order
      )
    `,
    )
    .eq("id", batchId)
    .single();

  if (batchError) {
    console.error("Batch query error:", batchError);
    throw new Error("Failed to fetch batch");
  }

  if (!batch) {
    throw new Error("Batch not found");
  }

  // Enrich pick lines with order and card details
  const lineIds = (batch.pick_lines || []).map((line: PickLineRow) => line.order_line_id);

  if (lineIds.length === 0) {
    const nodeName = (batch.fulfillment_node as unknown as BatchFulfilmentNode[] | null)?.[0]
      ?.name || "";
    return {
      id: batch.id,
      fulfilment_node_id: batch.fulfilment_node_id,
      node_name: nodeName,
      status: batch.status,
      created_at: batch.created_at,
      started_at: batch.started_at,
      completed_at: batch.completed_at,
      pick_lines: [],
      total_lines: 0,
      completed_lines: 0,
      total_items: 0,
      picked_items: 0,
    };
  }

  const { data: lineDetails, error: linesError } = await supabase
    .from("order_lines")
    .select(
      `
      id,
      order_id,
      orders(order_number),
      sellable_sku_id,
      sellable_skus(
        condition_id,
        conditions(name),
        language_id,
        languages(code),
        finish_id,
        finishes(name),
        card_printing:card_printings(
          oracle_card:oracle_cards(name),
          set:sets(code),
          collector_number
        )
      )
    `,
    )
    .in("id", lineIds);

  if (linesError) {
    console.error("Line details query error:", linesError);
    throw new Error("Failed to fetch line details");
  }

  const detailsMap = new Map(
    ((lineDetails as unknown) as LineDetail[] | null)?.map((line: LineDetail) => [line.id, line]) ||
      []
  );

  const enrichedLines: PickLineItem[] = (batch.pick_lines || [])
    .map((line: PickLineRow) => {
      const detail = detailsMap.get(line.order_line_id) as LineDetail | undefined;
      if (!detail) return null;

      const sku = detail.sellable_skus;
      const cardPrinting = sku?.card_printing;

      return {
        id: line.id,
        order_line_id: line.order_line_id,
        allocation_id: line.allocation_id,
        sku_id: line.sku_id,
        quantity_to_pick: line.quantity_to_pick,
        quantity_picked: line.quantity_picked,
        condition_confirmed: line.condition_confirmed,
        scan_count: line.scan_count,
        sort_order: line.sort_order,
        order_number: detail.orders?.order_number || "",
        card_name: cardPrinting?.oracle_card?.name || "",
        set_code: cardPrinting?.set?.code || "",
        collector_number: cardPrinting?.collector_number || "",
        language: sku?.languages?.code || "",
        finish: sku?.finishes?.name || "",
        expected_condition: sku?.conditions?.name || "",
      };
    })
    .filter(Boolean) as PickLineItem[];

  const totalItems = enrichedLines.reduce((sum, line) => sum + line.quantity_to_pick, 0);
  const pickedItems = enrichedLines.reduce((sum, line) => sum + line.quantity_picked, 0);
  const nodeName = (batch.fulfillment_node as unknown as BatchFulfilmentNode[] | null)?.[0]
    ?.name || "";

  return {
    id: batch.id,
    fulfilment_node_id: batch.fulfilment_node_id,
    node_name: nodeName,
    status: batch.status,
    created_at: batch.created_at,
    started_at: batch.started_at,
    completed_at: batch.completed_at,
    pick_lines: enrichedLines,
    total_lines: enrichedLines.length,
    completed_lines: enrichedLines.filter((line) => line.quantity_picked === line.quantity_to_pick)
      .length,
    total_items: totalItems,
    picked_items: pickedItems,
  };
}
