import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// Staff orders list handler (backlog B-140).
// Returns orders scoped by staff membership: a store user sees only their store's orders,
// a regional manager sees all stores in their region, etc. RLS policies on orders table
// enforce this scope via staff_has_node_access() helper from B-032.

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      },
    );

    // Verify user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Query orders with RLS applied (staff_has_node_access policy)
    // Includes order lines with SKU details and current allocation status
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
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Orders query error:", error);
      return NextResponse.json(
        { error: "Failed to fetch orders" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      orders: orders || [],
      count: orders?.length || 0,
    });
  } catch (error) {
    console.error("Staff orders API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
