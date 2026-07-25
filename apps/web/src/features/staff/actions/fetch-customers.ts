"use server";

// Customer-service lookup (backlog Step 18). Read-only by design: staff can
// see a customer's profile, addresses and order history, but every write to
// those records stays with the customer (see
// 20260725170000_staff_customer_directory_access.sql, which adds SELECT
// policies only).
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface CustomerSummary {
  id: string;
  displayName: string | null;
  phone: string | null;
  createdAt: string;
  orderCount: number;
  totalSpend: number;
  currency: string | null;
  lastOrderAt: string | null;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  fulfilmentType: string;
  totalAmount: number;
  currency: string;
  nodeName: string;
  createdAt: string;
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

export interface CustomerDetail extends CustomerSummary {
  orders: CustomerOrder[];
  addresses: CustomerAddress[];
}

const MAX_CUSTOMERS = 50;

interface OrderAggregateRow {
  customer_id: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
}

/**
 * Rolls per-order rows up into per-customer totals.
 *
 * Done in application code rather than SQL because PostgREST has no
 * group-by: the alternative would be a database view or RPC, which is more
 * machinery than a customer-service list of at most a few hundred orders
 * warrants.
 */
function aggregateOrders(orders: OrderAggregateRow[]) {
  const byCustomer = new Map<
    string,
    { orderCount: number; totalSpend: number; currency: string | null; lastOrderAt: string | null }
  >();

  for (const order of orders) {
    if (!order.customer_id) continue;

    const current = byCustomer.get(order.customer_id) ?? {
      orderCount: 0,
      totalSpend: 0,
      currency: null,
      lastOrderAt: null,
    };

    byCustomer.set(order.customer_id, {
      orderCount: current.orderCount + 1,
      totalSpend: current.totalSpend + Number(order.total_amount),
      currency: current.currency ?? order.currency,
      lastOrderAt:
        !current.lastOrderAt || order.created_at > current.lastOrderAt
          ? order.created_at
          : current.lastOrderAt,
    });
  }

  return byCustomer;
}

export async function searchCustomers(query: string): Promise<CustomerSummary[]> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return [];
  }

  if (!staffContext.permissions.includes("users.view")) {
    throw new Error("You do not have the users.view permission");
  }

  const supabase = createServerSupabaseClient();

  let profileQuery = supabase
    .from("profiles")
    .select("id, display_name, phone, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_CUSTOMERS);

  const term = query.trim();
  if (term) {
    profileQuery = profileQuery.ilike("display_name", `%${term}%`);
  }

  const { data: profiles, error } = await profileQuery;

  if (error) {
    logger.error("Customer search failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to search customers");
  }

  const customerIds = (profiles ?? []).map((profile) => profile.id);

  if (customerIds.length === 0) {
    return [];
  }

  // Only orders at the staff member's own nodes are visible here — that is
  // orders_select_staff doing its job, so the spend figures are "with your
  // stores", not group-wide.
  const { data: orders } = await supabase
    .from("orders")
    .select("customer_id, total_amount, currency, created_at")
    .in("customer_id", customerIds);

  const aggregates = aggregateOrders((orders ?? []) as OrderAggregateRow[]);

  return (profiles ?? []).map((profile) => {
    const aggregate = aggregates.get(profile.id);

    return {
      id: profile.id,
      displayName: profile.display_name,
      phone: profile.phone,
      createdAt: profile.created_at,
      orderCount: aggregate?.orderCount ?? 0,
      totalSpend: aggregate?.totalSpend ?? 0,
      currency: aggregate?.currency ?? null,
      lastOrderAt: aggregate?.lastOrderAt ?? null,
    };
  });
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail | null> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return null;
  }

  if (!staffContext.permissions.includes("users.view")) {
    throw new Error("You do not have the users.view permission");
  }

  const supabase = createServerSupabaseClient();

  const [{ data: profile }, { data: orders }, { data: addresses }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, phone, created_at")
      .eq("id", customerId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        status,
        fulfilment_type,
        total_amount,
        currency,
        created_at,
        node:fulfilment_nodes!inner(name)
      `,
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("customer_addresses")
      .select("id, label, line1, line2, city, region, postal_code, country, is_default")
      .eq("customer_id", customerId)
      .order("is_default", { ascending: false }),
  ]);

  if (!profile) {
    return null;
  }

  interface OrderQueryRow {
    id: string;
    order_number: string;
    status: string;
    fulfilment_type: string;
    total_amount: number;
    currency: string;
    created_at: string;
    node: { name: string } | null;
  }

  const orderRows = (orders ?? []) as unknown as OrderQueryRow[];
  const aggregate = aggregateOrders(
    orderRows.map((order) => ({
      customer_id: customerId,
      total_amount: order.total_amount,
      currency: order.currency,
      created_at: order.created_at,
    })),
  ).get(customerId);

  return {
    id: profile.id,
    displayName: profile.display_name,
    phone: profile.phone,
    createdAt: profile.created_at,
    orderCount: aggregate?.orderCount ?? 0,
    totalSpend: aggregate?.totalSpend ?? 0,
    currency: aggregate?.currency ?? null,
    lastOrderAt: aggregate?.lastOrderAt ?? null,
    orders: orderRows.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      fulfilmentType: order.fulfilment_type,
      totalAmount: Number(order.total_amount),
      currency: order.currency,
      nodeName: order.node?.name ?? "",
      createdAt: order.created_at,
    })),
    addresses: (addresses ?? []).map((address) => ({
      id: address.id,
      label: address.label,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postal_code,
      country: address.country,
      isDefault: address.is_default,
    })),
  };
}
