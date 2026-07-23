import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  fetchCustomerOrders,
  type CustomerOrderSummary,
} from "@/features/customer/actions/fetch-customer-orders";

// Requires an authenticated user's session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  picking: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100",
  packed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
  shipped: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100",
  delivered: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
};

export default async function OrderHistoryPage() {
  let orders: CustomerOrderSummary[] = [];
  let error: string | null = null;

  try {
    orders = await fetchCustomerOrders(50);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load orders";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Order History</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Track your orders and their delivery status.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>No orders yet.</p>
          <Link href="/" className="text-blue-600 hover:underline">
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Order #</th>
                <th className="px-6 py-3 text-left font-semibold">Status</th>
                <th className="px-6 py-3 text-left font-semibold">Type</th>
                <th className="px-6 py-3 text-left font-semibold">Items</th>
                <th className="px-6 py-3 text-right font-semibold">Total</th>
                <th className="px-6 py-3 text-left font-semibold">Date</th>
                <th className="px-6 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b hover:bg-muted/50">
                  <td className="px-6 py-3 font-mono text-xs font-semibold">{order.order_number}</td>
                  <td className="px-6 py-3">
                    <Badge className={statusColors[order.status]}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-xs">
                    {order.fulfillment_type === "click_and_collect"
                      ? "Click & Collect"
                      : "Online Shipping"}
                  </td>
                  <td className="px-6 py-3 text-xs">{order.line_count} item(s)</td>
                  <td className="px-6 py-3 text-right font-semibold">
                    {new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: order.currency,
                    }).format(order.total_amount / 100)}
                  </td>
                  <td className="px-6 py-3 text-xs text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString("en-AU")}
                  </td>
                  <td className="px-6 py-3">
                    <Link href={`/orders/${order.id}`} className="text-blue-600 hover:underline">
                      View
                    </Link>
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
