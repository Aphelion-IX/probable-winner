import Link from "next/link";
import { getDashboardStats, type DashboardStats } from "@/features/staff/actions/get-dashboard-stats";
import { Badge } from "@/components/ui/badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

interface StatCard {
  label: string;
  value: number;
  href: string;
  color: string;
  icon: string;
}

const defaultStats: DashboardStats = {
  pending_orders: 0,
  active_pick_batches: 0,
  pending_exceptions: 0,
  ready_shipments: 0,
  ready_handovers: 0,
  recent_orders: [],
};

export default async function StaffDashboardPage() {
  let stats = defaultStats;
  let error: string | null = null;

  try {
    stats = await getDashboardStats();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load dashboard";
  }

  const statCards: StatCard[] = [
    {
      label: "Pending Orders",
      value: stats.pending_orders,
      href: "/staff/orders",
      color: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900",
      icon: "📦",
    },
    {
      label: "Active Pick Batches",
      value: stats.active_pick_batches,
      href: "/staff/picking",
      color: "bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-900",
      icon: "🎯",
    },
    {
      label: "Exceptions to Resolve",
      value: stats.pending_exceptions,
      href: "/staff/picking",
      color: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900",
      icon: "⚠️",
    },
    {
      label: "Ready to Ship",
      value: stats.ready_shipments,
      href: "/staff/packing",
      color: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900",
      icon: "🚚",
    },
    {
      label: "Ready for Handover",
      value: stats.ready_handovers,
      href: "/staff/handover",
      color: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-900",
      icon: "🤝",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Staff Dashboard</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Fulfillment workflow overview and quick access to active tasks.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      )}

      {/* Workflow Visualization */}
      <div className="rounded-lg border bg-white p-6 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-muted-foreground mb-4">Fulfillment Pipeline</h2>
        <div className="flex items-center justify-between">
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{stats.pending_orders}</div>
            <div className="mt-1 text-xs font-medium">Orders</div>
          </div>
          <div className="text-2xl text-muted-foreground">→</div>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{stats.active_pick_batches}</div>
            <div className="mt-1 text-xs font-medium">Picking</div>
          </div>
          <div className="text-2xl text-muted-foreground">→</div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{stats.ready_shipments}</div>
            <div className="mt-1 text-xs font-medium">Packing</div>
          </div>
          <div className="text-2xl text-muted-foreground">→</div>
          <div className="text-center">
            <div className="text-3xl font-bold text-amber-600">{stats.ready_handovers}</div>
            <div className="mt-1 text-xs font-medium">Handover</div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className={`rounded-lg border p-6 transition-all hover:shadow-lg hover:-translate-y-1 cursor-pointer ${card.color}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-3xl font-bold">{card.value}</p>
              </div>
              <div className="text-3xl">{card.icon}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Orders */}
      <div className="rounded-lg border bg-white dark:bg-gray-900">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Recent Orders</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Order #</th>
                <th className="px-6 py-3 text-left font-semibold">Type</th>
                <th className="px-6 py-3 text-left font-semibold">Status</th>
                <th className="px-6 py-3 text-left font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_orders.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    No orders yet
                  </td>
                </tr>
              ) : (
                stats.recent_orders.map((order) => (
                  <tr key={order.id} className="border-b hover:bg-muted/50">
                    <td className="px-6 py-3 font-mono text-xs font-semibold">
                      {order.order_number}
                    </td>
                    <td className="px-6 py-3 text-xs">
                      {order.fulfilment_type === "click_and_collect"
                        ? "Click & Collect"
                        : "Online Shipping"}
                    </td>
                    <td className="px-6 py-3">
                      <Badge
                        className={
                          order.status === "pending"
                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
                            : order.status === "confirmed"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                              : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                        }
                      >
                        {order.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString("en-AU", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/staff/orders"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <h3 className="font-semibold">📋 View Orders</h3>
          <p className="mt-1 text-sm text-muted-foreground">See all orders in your scope</p>
        </Link>
        <Link
          href="/staff/picking"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <h3 className="font-semibold">🎯 Pick Batches</h3>
          <p className="mt-1 text-sm text-muted-foreground">Active picking tasks</p>
        </Link>
        <Link
          href="/staff/packing"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <h3 className="font-semibold">📦 Packing</h3>
          <p className="mt-1 text-sm text-muted-foreground">Prepare orders for shipment</p>
        </Link>
        <Link
          href="/staff/handover"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <h3 className="font-semibold">🤝 Handover</h3>
          <p className="mt-1 text-sm text-muted-foreground">Click & collect pickups</p>
        </Link>
        <Link
          href="/staff/inventory"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <h3 className="font-semibold">📊 Inventory</h3>
          <p className="mt-1 text-sm text-muted-foreground">Check stock levels</p>
        </Link>
        <Link
          href="/staff/settings"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <h3 className="font-semibold">⚙️ Settings</h3>
          <p className="mt-1 text-sm text-muted-foreground">Account & preferences</p>
        </Link>
      </div>
    </div>
  );
}
