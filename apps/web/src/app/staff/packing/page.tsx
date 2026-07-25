import { createServerSupabaseClient } from "@/server/supabase";
import { Badge } from "@/components/ui/badge";
import { logger, getRequestId } from "@/lib/logger";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

interface BatchFulfilmentNode {
  name: string;
  code: string;
}

interface BatchShipment {
  id: string;
  status: string;
}

interface CompletedBatch {
  id: string;
  status: string;
  pick_lines: Array<{ id: string }>;
  fulfillment_node: BatchFulfilmentNode[];
  packing_shipments: BatchShipment[];
}

async function getCompletedBatches(): Promise<CompletedBatch[]> {
  const supabase = createServerSupabaseClient();

  const { data: batches, error } = await supabase
    .from("pick_batches")
    .select(
      `
      id,
      status,
      pick_lines(id),
      fulfillment_node:fulfilment_nodes(name, code),
      packing_shipments(id, status)
    `,
    )
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error("Fetch completed pick batches failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch batches");
  }

  return batches || [];
}

export default async function StaffPackingPage() {
  let batches: CompletedBatch[] = [];
  let error: string | null = null;

  try {
    batches = await getCompletedBatches();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load batches";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packing"
        description="Pack completed pick batches and generate shipping labels."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No completed pick batches awaiting packing.
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => {
            const node = (batch.fulfillment_node as BatchFulfilmentNode[])?.[0];
            const lineCount = batch.pick_lines.length;
            const hasShipment = (batch.packing_shipments as BatchShipment[])?.length > 0;
            const shipment = (batch.packing_shipments as BatchShipment[])?.[0];

            return (
              <a
                key={batch.id}
                href={`/staff/packing/${batch.id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-semibold">{batch.id.slice(0, 8)}</div>
                      {hasShipment ? (
                        <StatusBadge status={shipment?.status ?? "pending"} />
                      ) : (
                        <Badge variant="outline">Ready to Pack</Badge>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {node?.code} • {lineCount} items
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
