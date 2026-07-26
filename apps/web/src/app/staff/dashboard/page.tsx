import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Handshake,
  PackageCheck,
  Settings,
  Target,
  Truck,
} from "lucide-react";

import {
  getDashboardStats,
  type DashboardStats,
} from "@/features/staff/actions/get-dashboard-stats";
import { PageHeader } from "@/components/staff/page-header";
import { StatCard } from "@/components/staff/stat-card";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

const defaultStats: DashboardStats = {
  pending_orders: 0,
  active_pick_batches: 0,
  pending_exceptions: 0,
  ready_shipments: 0,
  ready_handovers: 0,
  recent_orders: [],
};

const QUICK_LINKS = [
  {
    href: "/staff/orders",
    icon: Boxes,
    title: "View Orders",
    description: "See all orders in your scope",
  },
  {
    href: "/staff/picking",
    icon: Target,
    title: "Pick Batches",
    description: "Active picking tasks",
  },
  {
    href: "/staff/packing",
    icon: PackageCheck,
    title: "Packing",
    description: "Prepare orders for shipment",
  },
  {
    href: "/staff/handover",
    icon: Handshake,
    title: "Handover",
    description: "Click & collect pickups",
  },
  { href: "/staff/inventory", icon: Boxes, title: "Inventory", description: "Check stock levels" },
  {
    href: "/staff/settings",
    icon: Settings,
    title: "Settings",
    description: "Account & preferences",
  },
];

export default async function StaffDashboardPage() {
  let stats = defaultStats;
  let error: string | null = null;

  try {
    stats = await getDashboardStats();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load dashboard";
  }

  const statCards = [
    { label: "Pending Orders", value: stats.pending_orders, href: "/staff/orders", icon: Boxes },
    {
      label: "Active Pick Batches",
      value: stats.active_pick_batches,
      href: "/staff/picking",
      icon: Target,
    },
    {
      label: "Exceptions to Resolve",
      value: stats.pending_exceptions,
      href: "/staff/picking",
      icon: AlertTriangle,
      tone: "destructive" as const,
    },
    { label: "Ready to Ship", value: stats.ready_shipments, href: "/staff/packing", icon: Truck },
    {
      label: "Ready for Handover",
      value: stats.ready_handovers,
      href: "/staff/handover",
      icon: Handshake,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Staff Dashboard"
        description="Fulfillment workflow overview and quick access to active tasks."
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Fulfillment Pipeline</h2>
        <div className="flex items-center justify-between">
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">{stats.pending_orders}</div>
            <div className="mt-1 text-xs font-medium">Orders</div>
          </div>
          <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">{stats.active_pick_batches}</div>
            <div className="mt-1 text-xs font-medium">Picking</div>
          </div>
          <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">{stats.ready_shipments}</div>
            <div className="mt-1 text-xs font-medium">Packing</div>
          </div>
          <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">{stats.ready_handovers}</div>
            <div className="mt-1 text-xs font-medium">Handover</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="rounded-lg border bg-card">
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
                      <StatusBadge status={order.status} />
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
