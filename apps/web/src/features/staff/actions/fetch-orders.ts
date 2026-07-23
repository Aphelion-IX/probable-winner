"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

export interface OrderLineItem {
  id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sellable_sku: {
    id: string;
    card_printing: {
      id: string;
      collector_number: string;
      oracle_card: {
        id: string;
        name: string;
      };
      set: {
        code: string;
        name: string;
      };
    };
    language: string;
    finish: string;
    condition: string;
  };
}

export interface StaffOrder {
  id: string;
  order_number: string;
  status: string;
  fulfillment_type: string;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
  customer_id: string;
  fulfilment_node_id: string;
  fulfillment_node: {
    id: string;
    name: string;
    code: string;
  };
  order_lines: OrderLineItem[];
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  fulfillment_type: string;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
  customer_id: string;
  fulfilment_node_id: string;
  fulfillment_node: Array<{
    id: string;
    name: string;
    code: string;
  }>;
  order_lines: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    sellable_sku: {
      id: string;
      card_printing: {
        id: string;
        collector_number: string;
        oracle_card: {
          id: string;
          name: string;
        };
        set: {
          code: string;
          name: string;
        };
      };
      language: string;
      finish: string;
      condition: string;
    };
  }>;
}

// Fetch orders visible to the authenticated staff member.
// RLS policies on the orders table enforce scope:
// - Store staff see only their store's orders
// - Regional managers see all orders in their region
// - Org managers see all orders
export async function fetchStaffOrders(): Promise<StaffOrder[]> {
  const supabase = createServerSupabaseClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      order_number,
      status,
      fulfillment_type,
      total_amount,
      currency,
      created_at,
      updated_at,
      customer_id,
      fulfilment_node_id,
      fulfillment_node:fulfilment_nodes(id, name, code),
      order_lines(
        id,
        quantity,
        unit_price,
        line_total,
        sellable_sku:sellable_skus(
          id,
          card_printing:card_printings(
            id,
            collector_number,
            oracle_card:oracle_cards(id, name),
            set:sets(code, name)
          ),
          language,
          finish,
          condition
        )
      )
    `,
    )
    .returns<OrderRow[]>()
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error("Fetch staff orders failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch orders");
  }

  // Transform: fulfillment_node comes as array but should be single object
  return (orders || []).map((order) => ({
    ...order,
    fulfillment_node: order.fulfillment_node[0] || { id: "", name: "", code: "" },
  }));
}
