import {
  getReadyForHandoverOrders,
  type OrderForHandover,
} from "@/features/staff/actions/handle-click-and-collect";
import { getStaffContext } from "@/server/staff-context";
import { Badge } from "@/components/ui/badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffHandoverPage() {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
        Not authenticated as staff member
      </div>
    );
  }

  const nodeId = staffContext.nodeId;

  let orders: OrderForHandover[] = [];
  let error: string | null = null;

  try {
    orders = await getReadyForHandoverOrders(nodeId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load orders";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Click &amp; Collect Handover</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scan order barcodes to hand over completed orders to customers.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No orders ready for click &amp; collect handover at this location.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order: OrderForHandover) => (
            <a
              key={order.order_id}
              href={`/staff/handover/${order.order_id}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold">{order.order_number}</span>
                    <Badge className="bg-green-600">Ready</Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Click to confirm handover to customer
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">
                    {new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: order.currency,
                    }).format(order.total_amount / 100)}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
