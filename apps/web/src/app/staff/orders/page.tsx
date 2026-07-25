import { fetchStaffOrders, type StaffOrder } from "@/features/staff/actions/fetch-orders";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffOrdersPage() {
  let orders: StaffOrder[] = [];
  let error: string | null = null;

  try {
    orders = await fetchStaffOrders();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load orders";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Manage orders pending fulfillment. Click an order to begin picking."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No orders pending fulfillment in your scope.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold">Order #</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Lines</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-left font-semibold">Node</th>
                <th className="px-4 py-3 text-left font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    {order.order_number}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {order.fulfilment_type === "click_and_collect"
                      ? "Click & Collect"
                      : "Online Shipping"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {order.order_lines.length}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: order.currency,
                    }).format(order.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">{order.fulfillment_node.code}</td>
                  <td className="px-4 py-3 text-xs">
                    {new Date(order.created_at).toLocaleDateString("en-AU", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
