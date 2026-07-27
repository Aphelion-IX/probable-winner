"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/staff/status-badge";
import {
  createShipmentForBatch,
  generateShipmentLabel,
  markShipmentShipped,
  type Shipment,
  type ShipmentCarrier,
} from "@/features/staff/actions/manage-shipment";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

// The packing detail page's own action surface: create a shipment from this
// completed batch (backlog B-144), then label and dispatch it. Distinct
// from ShippingQueue (the cross-batch dispatch desk), which lists shipments
// that already exist -- this component is what creates the first one.
export function PackingBatchActions({
  batchId,
  batchStatus,
  initialShipment,
  carriers,
}: {
  batchId: string;
  batchStatus: string;
  initialShipment: Shipment | null;
  carriers: ShipmentCarrier[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carrierCode, setCarrierCode] = useState("");
  const [tracking, setTracking] = useState("");
  const [showLabelForm, setShowLabelForm] = useState(false);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      Sentry.captureException(err);
    } finally {
      setPending(false);
    }
  }

  if (batchStatus !== "completed") {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        This batch isn&rsquo;t fully picked yet -- packing becomes available once every line is
        picked.
      </div>
    );
  }

  if (!initialShipment) {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="text-sm font-semibold">Pack this batch</div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={carrierCode}
            onChange={(event) => setCarrierCode(event.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Choose carrier (optional)</option>
            {carriers.map((carrier) => (
              <option key={carrier.id} value={carrier.code}>
                {carrier.name}
              </option>
            ))}
          </select>
          <Button
            disabled={pending}
            onClick={() =>
              run(async () => {
                await createShipmentForBatch(batchId, carrierCode || undefined);
              })
            }
          >
            {pending ? "Creating…" : "Create shipment"}
          </Button>
        </div>
      </div>
    );
  }

  const shipment = initialShipment;
  const canShip = shipment.status !== "shipped" && shipment.status !== "cancelled";

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Shipment</div>
        <StatusBadge status={shipment.status} label={shipment.status.replace(/_/g, " ")} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Carrier</dt>
          <dd>{shipment.carrier?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Tracking</dt>
          <dd className="font-mono">{shipment.tracking_number ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Packed</dt>
          <dd>{formatTimestamp(shipment.packed_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Shipped</dt>
          <dd>{formatTimestamp(shipment.shipped_at)}</dd>
        </div>
      </dl>

      {showLabelForm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3">
          <Input
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            placeholder="Tracking number"
            aria-label="Tracking number"
            className="w-56"
          />
          <Button
            disabled={pending || tracking.trim() === ""}
            onClick={() =>
              run(async () => {
                await generateShipmentLabel(shipment.id, tracking.trim());
                setShowLabelForm(false);
                setTracking("");
              })
            }
          >
            {pending ? "Saving…" : "Save label"}
          </Button>
          <Button variant="outline" onClick={() => setShowLabelForm(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {canShip ? (
            <Button variant="outline" onClick={() => setShowLabelForm(true)}>
              {shipment.tracking_number ? "Update label" : "Generate label"}
            </Button>
          ) : null}
          {canShip ? (
            <Button
              disabled={pending}
              onClick={() => run(async () => markShipmentShipped(shipment.id))}
            >
              {pending ? "Saving…" : "Mark shipped"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
