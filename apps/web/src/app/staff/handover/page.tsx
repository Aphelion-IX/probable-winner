import {
  getReadyForHandoverOrders,
  type OrderForHandover,
} from "@/features/staff/actions/handle-click-and-collect";
import { getStaffContext } from "@/server/staff-context";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/staff/page-header";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffHandoverPage() {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
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
      <PageHeader
        title="Click & Collect Handover"
        description="Scan order barcodes to hand over completed orders to customers."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
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
              className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold">{order.order_number}</span>
                    <Badge variant="success">Ready</Badge>
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
                    }).format(order.total_amount)}
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
