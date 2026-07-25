"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/staff/status-badge";
import {
  generateShipmentLabel,
  markShipmentShipped,
  type ShipmentQueueItem,
} from "@/features/staff/actions/manage-shipment";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Statuses from which generate_shipment_label() is a sensible next step.
 * Once a shipment is shipped or cancelled there is nothing left to label.
 */
const LABELLABLE = new Set(["pending", "packed", "labeled", "ready_to_ship"]);

export function ShippingQueue({ shipments }: { shipments: ShipmentQueueItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [labelDraftId, setLabelDraftId] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");

  async function run(id: string, action: () => Promise<void>) {
    setPendingId(id);
    setError(null);

    try {
      await action();
      setLabelDraftId(null);
      setTracking("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      Sentry.captureException(err);
    } finally {
      setPendingId(null);
    }
  }

  if (shipments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No shipments have been created at your stores yet. Shipments are created from a completed
        pick batch on the Packing screen.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-semibold">Shipment</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Store</th>
              <th className="px-4 py-3 text-left font-semibold">Carrier</th>
              <th className="px-4 py-3 text-left font-semibold">Tracking</th>
              <th className="px-4 py-3 text-left font-semibold">Shipped</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((shipment) => (
              <tr key={shipment.id} className="border-b align-top last:border-b-0">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-semibold">
                    {shipment.id.slice(0, 8).toUpperCase()}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Batch {shipment.pickBatchId.slice(0, 8).toUpperCase()}
                    {shipment.weightKg !== null ? ` · ${shipment.weightKg} kg` : ""}
                  </div>
                  {labelDraftId === shipment.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3">
                      <Input
                        value={tracking}
                        onChange={(event) => setTracking(event.target.value)}
                        placeholder="Tracking number"
                        aria-label="Tracking number"
                        className="w-56"
                      />
                      <Button
                        disabled={pendingId === shipment.id || tracking.trim() === ""}
                        onClick={() =>
                          run(shipment.id, () =>
                            generateShipmentLabel(shipment.id, tracking.trim()),
                          )
                        }
                      >
                        {pendingId === shipment.id ? "Saving…" : "Save label"}
                      </Button>
                      <Button variant="outline" onClick={() => setLabelDraftId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={shipment.status} label={shipment.status.replace(/_/g, " ")} />
                </td>
                <td className="px-4 py-3 text-xs">{shipment.nodeName}</td>
                <td className="px-4 py-3 text-xs">{shipment.carrierName ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{shipment.trackingNumber ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatTimestamp(shipment.shippedAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {LABELLABLE.has(shipment.status) ? (
                      <Button
                        variant="outline"
                        className="text-xs"
                        onClick={() =>
                          setLabelDraftId(labelDraftId === shipment.id ? null : shipment.id)
                        }
                      >
                        {shipment.trackingNumber ? "Update label" : "Add label"}
                      </Button>
                    ) : null}
                    {shipment.status !== "shipped" && shipment.status !== "cancelled" ? (
                      <Button
                        className="text-xs"
                        disabled={pendingId === shipment.id}
                        onClick={() => run(shipment.id, () => markShipmentShipped(shipment.id))}
                      >
                        <Truck className="size-3.5" aria-hidden />
                        {pendingId === shipment.id ? "Saving…" : "Mark shipped"}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
