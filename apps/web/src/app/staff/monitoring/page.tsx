import { getSystemHealth } from "@/features/staff/actions/get-system-health";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

const QUEUE_LABELS: Record<string, string> = {
  catalogue_import: "Catalogue Import",
  pricing_import: "Pricing Import",
  search_index: "Search Index (Typesense sync)",
  email: "Email",
  restock_alerts: "Restock Alerts",
  order_processing: "Order Processing",
  reservation_cleanup: "Reservation Cleanup",
  stock_reconciliation: "Stock Reconciliation",
  report_generation: "Report Generation",
};

export default async function SystemMonitoringPage() {
  let health = null;
  let error: string | null = null;

  try {
    health = await getSystemHealth();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load system health";
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">System Monitoring</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">System Monitoring</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const unhealthyQueueCount = health.queues.filter((q) => !q.healthy).length;
  const totalFailedRuns = health.importFailures.reduce((sum, f) => sum + f.failedRunCount, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Monitoring</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Queue backlog age and import pipeline health (backlog B-202).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Queues Over Threshold</p>
              <p className="mt-2 text-3xl font-bold">{unhealthyQueueCount}</p>
            </div>
            {unhealthyQueueCount > 0 ? (
              <AlertTriangle className="h-8 w-8 text-orange-500" />
            ) : (
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            )}
          </div>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Failed Imports (24h)</p>
              <p className="mt-2 text-3xl font-bold">{totalFailedRuns}</p>
            </div>
            {totalFailedRuns > 0 ? (
              <AlertTriangle className="h-8 w-8 text-orange-500" />
            ) : (
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Activity className="h-5 w-5" />
          Queue Backlog
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Queue</th>
                <th className="px-6 py-3 text-right font-semibold">Depth</th>
                <th className="px-6 py-3 text-right font-semibold">Oldest Message</th>
                <th className="px-6 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {health.queues.map((queue) => (
                <tr key={queue.queueName} className="border-b hover:bg-muted/50">
                  <td className="px-6 py-3 font-medium">
                    {QUEUE_LABELS[queue.queueName] ?? queue.queueName}
                  </td>
                  <td className="px-6 py-3 text-right">{queue.queueLength}</td>
                  <td className="px-6 py-3 text-right">
                    {queue.oldestMsgAgeSeconds === null ? "—" : `${queue.oldestMsgAgeSeconds}s`}
                  </td>
                  <td className="px-6 py-3">
                    {queue.healthy ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                        Healthy
                      </Badge>
                    ) : (
                      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100">
                        Stale
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Import Pipeline Failures (Last 24h)</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Source</th>
                <th className="px-6 py-3 text-right font-semibold">Failed Runs</th>
                <th className="px-6 py-3 text-left font-semibold">Most Recent Failure</th>
              </tr>
            </thead>
            <tbody>
              {health.importFailures.map((failure) => (
                <tr key={failure.source} className="border-b hover:bg-muted/50">
                  <td className="px-6 py-3 font-medium">
                    {failure.source === "catalogue_import" ? "Catalogue Import" : "Pricing Import"}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {failure.failedRunCount === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      <span className="font-semibold text-orange-600">{failure.failedRunCount}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-xs text-muted-foreground">
                    {failure.mostRecentFailureAt
                      ? new Date(failure.mostRecentFailureAt).toLocaleString("en-AU")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
