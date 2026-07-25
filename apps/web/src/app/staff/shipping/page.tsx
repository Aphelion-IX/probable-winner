import { listShipments, type ShipmentQueueItem } from "@/features/staff/actions/manage-shipment";
import { ShippingQueue } from "@/features/staff/components/shipping-queue";
import { PageHeader } from "@/components/staff/page-header";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffShippingPage() {
  let shipments: ShipmentQueueItem[] = [];
  let error: string | null = null;

  try {
    shipments = await listShipments();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load shipments";
  }

  const awaitingDispatch = shipments.filter(
    (shipment) => shipment.status !== "shipped" && shipment.status !== "cancelled",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping"
        description="Label and dispatch packed shipments. Tracking numbers recorded here are what customers see on their order."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          {shipments.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs font-medium text-muted-foreground">Awaiting dispatch</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{awaitingDispatch}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs font-medium text-muted-foreground">Shipments (last 100)</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{shipments.length}</p>
              </div>
            </div>
          ) : null}

          <ShippingQueue shipments={shipments} />
        </>
      )}
    </div>
  );
}
