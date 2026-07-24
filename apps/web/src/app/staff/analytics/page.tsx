import { getAnalyticsData } from "@/features/staff/actions/get-analytics";
import { TrendingUp, AlertTriangle, Package, DollarSign } from "lucide-react";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function AnalyticsDashboard() {
  let analytics = null;
  let error: string | null = null;

  try {
    analytics = await getAnalyticsData();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load analytics";
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Key metrics and insights for the last 30 days.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Total Orders</p>
              <p className="mt-2 text-3xl font-bold">{analytics.totalOrders}</p>
            </div>
            <Package className="h-8 w-8 opacity-50" />
          </div>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Total Revenue</p>
              <p className="mt-2 text-3xl font-bold">
                {new Intl.NumberFormat("en-AU", {
                  style: "currency",
                  currency: "AUD",
                }).format(analytics.totalRevenue)}
              </p>
            </div>
            <DollarSign className="h-8 w-8 opacity-50" />
          </div>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Avg Margin</p>
              <p className="mt-2 text-3xl font-bold">
                {analytics.pricingStats.average_margin_percent.toFixed(1)}%
              </p>
            </div>
            <TrendingUp className="h-8 w-8 opacity-50" />
          </div>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Exceptions</p>
              <p className="mt-2 text-3xl font-bold">{analytics.exceptionCount}</p>
            </div>
            <AlertTriangle className="h-8 w-8 opacity-50" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Order Trends (Last 30 Days)</h2>
        <div className="rounded-lg border p-6">
          {analytics.orderTrends.length === 0 ? (
            <p className="text-sm text-muted-foreground">No order data available</p>
          ) : (
            <div className="space-y-4">
              {analytics.orderTrends.map((trend) => (
                <div key={trend.date} className="flex items-center justify-between gap-4">
                  <div className="w-24 text-sm font-medium">{trend.date}</div>
                  <div className="flex-1">
                    <div
                      className="h-8 rounded-lg bg-blue-100 dark:bg-blue-900"
                      style={{ width: `${Math.min(100, (trend.count / 10) * 100)}%` }}
                    />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{trend.count} orders</p>
                    <p className="text-xs text-muted-foreground">
                      {new Intl.NumberFormat("en-AU", {
                        style: "currency",
                        currency: "AUD",
                      }).format(trend.revenue)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Popular Cards (Last 30 Days)</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Card</th>
                <th className="px-6 py-3 text-left font-semibold">Set</th>
                <th className="px-6 py-3 text-right font-semibold">Units Sold</th>
                <th className="px-6 py-3 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {analytics.popularCards.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-3 text-center text-sm text-muted-foreground">
                    No sales data available
                  </td>
                </tr>
              ) : (
                analytics.popularCards.map((card) => (
                  <tr
                    key={`${card.card_name}-${card.set_name}`}
                    className="border-b hover:bg-muted/50"
                  >
                    <td className="px-6 py-3 font-medium">{card.card_name}</td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{card.set_name}</td>
                    <td className="px-6 py-3 text-right font-semibold">{card.total_units}</td>
                    <td className="px-6 py-3 text-right">
                      {new Intl.NumberFormat("en-AU", {
                        style: "currency",
                        currency: "AUD",
                      }).format(card.total_revenue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Pricing Statistics</h2>
          <div className="rounded-lg border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Cards in Review</span>
              <span className="text-lg font-semibold">
                {analytics.pricingStats.cards_in_review}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Auto-Approved</span>
              <span className="text-lg font-semibold">
                {analytics.pricingStats.auto_approved_count}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Manual Approvals</span>
              <span className="text-lg font-semibold">
                {analytics.pricingStats.manual_approved_count}
              </span>
            </div>
            <div className="flex items-center justify-between border-t pt-4">
              <span className="text-sm font-semibold">Approval Rate</span>
              <span className="text-lg font-bold">
                {analytics.pricingStats.approval_rate_percent.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Fulfillment Status</h2>
          <div className="rounded-lg border p-6 space-y-4">
            {analytics.fulfillmentBreakdown.map((status) => (
              <div key={status.status}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium capitalize">{status.status}</span>
                  <span className="text-muted-foreground">
                    {status.count} ({status.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-2 rounded-full bg-blue-600"
                    style={{ width: `${status.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
