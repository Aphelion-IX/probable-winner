"use server";

import { createClient } from "@supabase/supabase-js";

import { resolveCheckoutIdentity, ownsResource } from "@/server/checkout-ownership";

interface CheckoutValidationError {
  field: string;
  message: string;
}

interface CreatePendingOrderResult {
  success: boolean;
  orderId?: string;
  errors?: CheckoutValidationError[];
}

interface CartData {
  id: string;
  organisation_id: string;
  customer_id: string | null;
  guest_token: string | null;
  cart_lines: Array<{
    id: string;
    sellable_sku_id: string;
    quantity: number;
    fulfilment_node_id: string;
    inventory_reservation_id: string;
    inventory_reservations: { id: string; expires_at: string } | null;
  }>;
}

// Validates the cart and hands the actual checkout conversion to the
// create_pending_order() database function (backlog B-130/B-131, hardened
// per the 2026-07-26 security re-audit's items 5/6/8), which performs the
// address/order/order_lines/order_allocations writes -- plus, for
// click-and-collect, re-reserving stock at the customer's chosen store when
// it differs from where the cart's lines were originally reserved -- in one
// atomic transaction. This action's own job is read-only: check ownership
// and surface friendly, field-level validation errors before ever calling
// that function, exactly as before.
export async function createPendingOrder(
  cartId: string,
  fulfillmentType: "delivery" | "collect",
  address?: {
    line1: string;
    line2?: string;
    suburb: string;
    state: string;
    postcode: string;
  },
  storeId?: string,
): Promise<CreatePendingOrderResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const errors: CheckoutValidationError[] = [];

  if (!fulfillmentType || !["delivery", "collect"].includes(fulfillmentType)) {
    errors.push({
      field: "fulfillmentType",
      message: "Invalid fulfillment type",
    });
  }

  if (fulfillmentType === "delivery") {
    if (!address?.line1?.trim()) {
      errors.push({
        field: "address.line1",
        message: "Street address is required for delivery",
      });
    }
    if (!address?.suburb?.trim()) {
      errors.push({
        field: "address.suburb",
        message: "Suburb/city is required for delivery",
      });
    }
    if (!address?.postcode?.trim()) {
      errors.push({
        field: "address.postcode",
        message: "Postcode is required for delivery",
      });
    } else if (!/^\d{4}$/.test(address.postcode)) {
      errors.push({
        field: "address.postcode",
        message: "Postcode must be 4 digits",
      });
    }
  }

  if (fulfillmentType === "collect" && !storeId?.trim()) {
    errors.push({
      field: "storeId",
      message: "Store selection is required for click and collect",
    });
  }

  // Fetch cart with organisation and items. cart_lines has no stored
  // price -- unlike order_lines (fixed at order time), a cart line's
  // price is always looked up fresh from published_prices at checkout,
  // so there's no "price at add" to detect drift against.
  //
  // customer_id/guest_token are selected for the ownership check below:
  // cartId arrives from the browser and this client is the service-role
  // one, which bypasses RLS, so nothing else would stop a caller passing
  // somebody else's cart id and turning their basket into an order.
  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select(
      `
      id,
      organisation_id,
      customer_id,
      guest_token,
      cart_lines(
        id,
        sellable_sku_id,
        quantity,
        fulfilment_node_id,
        inventory_reservation_id,
        inventory_reservations(
          id,
          expires_at
        )
      )
    `,
    )
    .eq("id", cartId)
    .single();

  if (cartError || !cart) {
    errors.push({
      field: "cart",
      message: "Cart not found",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cartData = cart as any as CartData;

  // Authorise before doing anything with the cart. Deliberately reports the
  // same "Cart not found" as a genuinely missing cart: telling an attacker
  // that a cart id exists but belongs to someone else is itself a leak, and
  // there is nothing a legitimate caller could do differently either way.
  const identity = await resolveCheckoutIdentity();

  if (cartData && !ownsResource(cartData, identity)) {
    return {
      success: false,
      errors: [{ field: "cart", message: "Cart not found" }],
    };
  }

  if (cartData && (!cartData.cart_lines || cartData.cart_lines.length === 0)) {
    errors.push({
      field: "cart",
      message: "Cart is empty",
    });
  }

  // Fetch current published prices for every line's SKU (fresh lookup,
  // not a stored value on the cart line) -- purely for a friendly
  // per-line error here; create_pending_order() looks these up again
  // itself at write time.
  const priceBySkuId = new Map<string, number>();
  if (cartData?.cart_lines?.length) {
    const skuIds = cartData.cart_lines.map((line) => line.sellable_sku_id);
    const { data: prices } = await supabase
      .from("published_prices")
      .select("sellable_sku_id, final_amount")
      .in("sellable_sku_id", skuIds)
      .eq("status", "active");

    for (const price of prices ?? []) {
      priceBySkuId.set(price.sellable_sku_id, price.final_amount);
    }
  }

  // Validate cart contents
  if (cartData?.id) {
    const now = new Date();
    for (const line of cartData.cart_lines) {
      const reservation = Array.isArray(line.inventory_reservations)
        ? line.inventory_reservations[0]
        : line.inventory_reservations;

      if (!reservation || (reservation.expires_at && new Date(reservation.expires_at) < now)) {
        errors.push({
          field: `cartLine_${line.id}`,
          message: "Item reservation has expired. Please add it to cart again.",
        });
      }

      if (!priceBySkuId.has(line.sellable_sku_id)) {
        errors.push({
          field: `cartLine_${line.id}_price`,
          message: "This item is no longer available for sale. Please remove it and try again.",
        });
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const { data, error: rpcError } = await supabase.rpc("create_pending_order", {
    p_cart_id: cartId,
    p_customer_id: identity.userId,
    p_guest_token: identity.guestToken,
    p_fulfilment_type: fulfillmentType === "delivery" ? "online_shipping" : "click_and_collect",
    p_address:
      fulfillmentType === "delivery"
        ? {
            line1: address!.line1,
            line2: address!.line2,
            suburb: address!.suburb,
            state: address!.state,
            postcode: address!.postcode,
          }
        : null,
    p_collection_store_id: fulfillmentType === "collect" ? storeId : null,
  });

  if (rpcError || !data) {
    return {
      success: false,
      errors: [
        {
          field: "order",
          message: rpcError?.message ?? "Failed to create order. Please try again.",
        },
      ],
    };
  }

  return { success: true, orderId: (data as { order_id: string }).order_id };
}
