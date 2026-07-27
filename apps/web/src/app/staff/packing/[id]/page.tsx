import { getPickBatch } from "@/features/staff/actions/get-pick-batch";
import {
  getShipmentsForBatch,
  getAvailableCarriers,
} from "@/features/staff/actions/manage-shipment";
import { PackingBatchActions } from "@/features/staff/components/packing-batch-actions";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

// Previously missing entirely: the packing list page
// (apps/web/src/app/staff/packing/page.tsx) has always linked to
// /staff/packing/[batchId], but nothing rendered here -- the fulfillment
// E2E spec (tests/e2e/fulfillment-flow.spec.ts) documented this as a
// confirmed 404. Mirrors the picking detail page's shape: batch summary +
// read-only line list, plus the actual packing/shipping actions
// (create_shipment/generate_shipment_label/mark_shipment_shipped) that
// convert a completed pick batch into a dispatched shipment.
export default async function PackingBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: batchId } = await params;

  let error: string | null = null;
  let batch: Awaited<ReturnType<typeof getPickBatch>> | null = null;
  let shipments: Awaited<ReturnType<typeof getShipmentsForBatch>> = [];
  let carriers: Awaited<ReturnType<typeof getAvailableCarriers>> = [];

  try {
    [batch, shipments, carriers] = await Promise.all([
      getPickBatch(batchId),
      getShipmentsForBatch(batchId),
      getAvailableCarriers(),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load batch";
  }

  if (error || !batch) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error || "Batch not found"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pack Batch"
        description={`${batch.node_name} • ${batch.total_lines} items`}
      />

      <div className="flex items-center gap-2">
        <StatusBadge status={batch.status} />
        <span className="text-sm text-muted-foreground">
          {batch.picked_items} of {batch.total_items} items picked
        </span>
      </div>

      <PackingBatchActions
        batchId={batch.id}
        batchStatus={batch.status}
        initialShipment={shipments[0] ?? null}
        carriers={carriers}
      />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Items</h2>
        {batch.pick_lines.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No items in this batch
          </div>
        ) : (
          batch.pick_lines
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((line) => (
              <div key={line.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {line.order_number}
                      </span>
                      <span className="text-sm font-medium">{line.card_name}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {line.set_code} #{line.collector_number} • {line.finish} • {line.language}
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium">
                    {line.quantity_picked}/{line.quantity_to_pick}
                  </div>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
