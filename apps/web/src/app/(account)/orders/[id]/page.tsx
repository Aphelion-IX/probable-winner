import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { fetchCustomerOrderDetail } from "@/features/customer/actions/fetch-customer-orders";
import { Package, Truck, MapPin, Calendar } from "lucide-react";

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

interface OrderDetailPageProps {
  params: {
    id: string;
  };
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  let order = null;
  let error: string | null = null;

  try {
    order = await fetchCustomerOrderDetail(params.id);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load order";
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Link href="/orders" className="text-blue-600 hover:underline">
          ← Back to Orders
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-6">
        <Link href="/orders" className="text-blue-600 hover:underline">
          ← Back to Orders
        </Link>
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>Order not found.</p>
        </div>
      </div>
    );
  }

  const orderDate = new Date(order.created_at).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const total = order.total_amount / 100;

  return (
    <div className="space-y-8">
      <Link href="/orders" className="text-blue-600 hover:underline">
        ← Back to Orders
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Order {order.order_number}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{orderDate}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Package className="h-4 w-4" />
            Status
          </div>
          <Badge className={`mt-2 ${statusColors[order.status]}`}>
            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
          </Badge>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="h-4 w-4" />
            Fulfillment Type
          </div>
          <p className="mt-2 text-sm">
            {order.fulfillment_type === "click_and_collect" ? "Click & Collect" : "Online Shipping"}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="text-sm font-semibold">Total Amount</div>
          <p className="mt-2 text-lg font-bold">
            {new Intl.NumberFormat("en-AU", {
              style: "currency",
              currency: order.currency,
            }).format(total)}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Order Items</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Card</th>
                <th className="px-6 py-3 text-left font-semibold">Set</th>
                <th className="px-6 py-3 text-right font-semibold">Quantity</th>
                <th className="px-6 py-3 text-right font-semibold">Unit Price</th>
                <th className="px-6 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.order_lines.map((line) => (
                <tr key={line.id} className="border-b hover:bg-muted/50">
                  <td className="px-6 py-3 font-medium">{line.card_name}</td>
                  <td className="px-6 py-3 text-xs text-muted-foreground">{line.set_name}</td>
                  <td className="px-6 py-3 text-right">{line.quantity}</td>
                  <td className="px-6 py-3 text-right">
                    {new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: order.currency,
                    }).format(line.unit_price / 100)}
                  </td>
                  <td className="px-6 py-3 text-right font-medium">
                    {new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: order.currency,
                    }).format((line.unit_price * line.quantity) / 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.shipment && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Shipment Tracking</h2>
          <div className="rounded-lg border p-6">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Carrier</p>
                <p className="mt-1 text-base">{order.shipment.carrier}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Tracking Number</p>
                <p className="mt-1 font-mono text-base">{order.shipment.tracking_number}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Status</p>
                <Badge className="mt-1 bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100">
                  {order.shipment.status.charAt(0).toUpperCase() + order.shipment.status.slice(1)}
                </Badge>
              </div>
              {order.shipment.estimated_delivery && (
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Estimated Delivery
                  </p>
                  <p className="mt-1 text-base">
                    {new Date(order.shipment.estimated_delivery).toLocaleDateString("en-AU")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {order.handover && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Click & Collect Handover</h2>
          <div className="rounded-lg border p-6">
            <div className="space-y-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  Handed Over
                </p>
                <p className="mt-1 text-base">
                  {new Date(order.handover.handed_over_at).toLocaleDateString("en-AU", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {order.handover.notes && (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">Notes</p>
                  <p className="mt-1 text-sm">{order.handover.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
