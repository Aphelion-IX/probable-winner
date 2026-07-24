import { createServerSupabaseClient } from "@/server/supabase";
import { Badge } from "@/components/ui/badge";
import { logger, getRequestId } from "@/lib/logger";

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Packing</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pack completed pick batches and generate shipping labels.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
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
                className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-semibold">{batch.id.slice(0, 8)}</div>
                      {hasShipment ? (
                        <Badge
                          className={
                            shipment?.status === "shipped"
                              ? "bg-green-600"
                              : shipment?.status === "labeled"
                                ? "bg-blue-600"
                                : "bg-yellow-600"
                          }
                        >
                          {shipment?.status || "pending"}
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-600">Ready to Pack</Badge>
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
