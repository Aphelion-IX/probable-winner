import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getCustomerAlerts, type CustomerPriceAlert, type CustomerRestockAlert } from "@/features/customer/actions/manage-alerts";
import { AlertCircle, Trash2, Plus } from "lucide-react";

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  triggered: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100",
};

const finishLabels: Record<string, string> = {
  normal: "Normal",
  foil: "Foil",
  etched: "Etched",
};

export default async function AlertsPage() {
  let priceAlerts: CustomerPriceAlert[] = [];
  let restockAlerts: CustomerRestockAlert[] = [];
  let error: string | null = null;

  try {
    const data = await getCustomerAlerts();
    priceAlerts = data.priceAlerts;
    restockAlerts = data.restockAlerts;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load alerts";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Monitor prices and restocks for cards you&apos;re interested in.
          </p>
        </div>
        <Link
          href="/account/alerts/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Alert
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      ) : priceAlerts.length === 0 && restockAlerts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <AlertCircle className="mx-auto h-8 w-8 opacity-50" />
          <p className="mt-2">No alerts yet.</p>
          <Link href="/account/alerts/new" className="mt-4 text-blue-600 hover:underline">
            Create your first alert
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {priceAlerts.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Price Alerts ({priceAlerts.length})</h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-6 py-3 text-left font-semibold">Card</th>
                      <th className="px-6 py-3 text-left font-semibold">Set</th>
                      <th className="px-6 py-3 text-left font-semibold">Finish</th>
                      <th className="px-6 py-3 text-right font-semibold">Alert Price</th>
                      <th className="px-6 py-3 text-left font-semibold">Status</th>
                      <th className="px-6 py-3 text-left font-semibold">Created</th>
                      <th className="px-6 py-3 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceAlerts.map((alert) => (
                      <tr key={alert.id} className="border-b hover:bg-muted/50">
                        <td className="px-6 py-3 font-medium">{alert.card_name}</td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">{alert.set_name}</td>
                        <td className="px-6 py-3 text-xs">{finishLabels[alert.finish]}</td>
                        <td className="px-6 py-3 text-right font-semibold">
                          {new Intl.NumberFormat("en-AU", {
                            style: "currency",
                            currency: alert.currency,
                          }).format(alert.alert_price / 100)}
                        </td>
                        <td className="px-6 py-3">
                          <Badge className={statusColors[alert.status]}>
                            {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">
                          {new Date(alert.created_at).toLocaleDateString("en-AU")}
                        </td>
                        <td className="px-6 py-3">
                          <form
                            action={async () => {
                              "use server";
                              const { deleteAlert } = await import(
                                "@/features/customer/actions/manage-alerts"
                              );
                              await deleteAlert(alert.id, "price");
                            }}
                            className="inline"
                          >
                            <button
                              type="submit"
                              className="text-red-600 hover:text-red-800"
                              title="Delete alert"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {restockAlerts.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Restock Alerts ({restockAlerts.length})</h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-6 py-3 text-left font-semibold">Card</th>
                      <th className="px-6 py-3 text-left font-semibold">Set</th>
                      <th className="px-6 py-3 text-left font-semibold">Finish</th>
                      <th className="px-6 py-3 text-left font-semibold">Condition</th>
                      <th className="px-6 py-3 text-left font-semibold">Status</th>
                      <th className="px-6 py-3 text-left font-semibold">Created</th>
                      <th className="px-6 py-3 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restockAlerts.map((alert) => (
                      <tr key={alert.id} className="border-b hover:bg-muted/50">
                        <td className="px-6 py-3 font-medium">{alert.card_name}</td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">{alert.set_name}</td>
                        <td className="px-6 py-3 text-xs">{finishLabels[alert.finish]}</td>
                        <td className="px-6 py-3 text-xs">{alert.condition}</td>
                        <td className="px-6 py-3">
                          <Badge className={statusColors[alert.status]}>
                            {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">
                          {new Date(alert.created_at).toLocaleDateString("en-AU")}
                        </td>
                        <td className="px-6 py-3">
                          <form
                            action={async () => {
                              "use server";
                              const { deleteAlert } = await import(
                                "@/features/customer/actions/manage-alerts"
                              );
                              await deleteAlert(alert.id, "restock");
                            }}
                            className="inline"
                          >
                            <button
                              type="submit"
                              className="text-red-600 hover:text-red-800"
                              title="Delete alert"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
