import { Clock, MapPin, Package } from "lucide-react";

import { fetchStoreDetails, type StoreDetail } from "@/features/staff/actions/fetch-store-details";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const NODE_TYPE_LABELS: Record<string, string> = {
  store: "Store",
  warehouse: "Warehouse",
  distribution_centre: "Distribution centre",
  event_location: "Event location",
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  // Postgres `time` comes back as HH:MM:SS; seconds are noise here.
  return value.slice(0, 5);
}

function formatAddress(store: StoreDetail): string | null {
  if (!store.address) return null;
  const { line1, line2, city, region, postalCode, country } = store.address;
  return [line1, line2, city, region, postalCode, country].filter(Boolean).join(", ");
}

function CapabilityBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return <Badge variant={enabled ? "success" : "outline"}>{label}</Badge>;
}

export default async function StaffStoresPage() {
  let stores: StoreDetail[] = [];
  let error: string | null = null;

  try {
    stores = await fetchStoreDetails();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load stores";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores"
        description="The fulfilment nodes in your scope, their capabilities, and the dispatch cutoffs the order-routing algorithm uses."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : stores.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Your staff membership does not grant access to any active fulfilment node.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {stores.map((store) => {
            const address = formatAddress(store);
            const openDays = store.hours.filter((hour) => !hour.closed);

            return (
              <article key={store.id} className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{store.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{store.code}</span> ·{" "}
                      {NODE_TYPE_LABELS[store.type] ?? store.type}
                      {store.region ? ` · ${store.region}` : ""}
                    </p>
                  </div>
                  <Badge variant={store.active ? "success" : "destructive"}>
                    {store.active ? "Active" : "Inactive"}
                  </Badge>
                </div>

                {address ? (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {address}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <CapabilityBadge enabled={store.allowsOnlineFulfilment} label="Online orders" />
                  <CapabilityBadge enabled={store.allowsClickCollect} label="Click &amp; collect" />
                  <CapabilityBadge enabled={store.allowsTransfers} label="Transfers" />
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Dispatch cutoff</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">
                      {formatTime(store.dispatchCutoff)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Timezone</dt>
                    <dd className="mt-0.5 font-medium">{store.timezone}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Locations</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">
                      {store.storageLocationCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Package className="size-3" aria-hidden />
                      SKUs in stock
                    </dt>
                    <dd className="mt-0.5 font-medium tabular-nums">{store.skusInStock}</dd>
                  </div>
                </dl>

                {openDays.length > 0 ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Clock className="size-3" aria-hidden />
                      Opening hours
                    </p>
                    <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      {store.hours.map((hour) => (
                        <li key={hour.dayOfWeek} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">
                            {DAY_NAMES[hour.dayOfWeek] ?? hour.dayOfWeek}
                          </span>
                          <span className="tabular-nums">
                            {hour.closed
                              ? "Closed"
                              : `${formatTime(hour.opensAt)}–${formatTime(hour.closesAt)}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
