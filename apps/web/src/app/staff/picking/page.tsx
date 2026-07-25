import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";
import { GeneratePickBatchButton } from "@/features/staff/components/generate-pick-batch-button";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

interface PickBatchFulfilmentNode {
  name: string;
  code: string;
}

interface PickBatch {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  pick_lines: Array<{ id: string }>;
  fulfillment_node: PickBatchFulfilmentNode[];
}

async function getActiveBatches(): Promise<PickBatch[]> {
  const supabase = createServerSupabaseClient();

  const { data: batches, error } = await supabase
    .from("pick_batches")
    .select(
      `
      id,
      status,
      created_at,
      started_at,
      pick_lines(id),
      fulfillment_node:fulfilment_nodes(name, code)
    `,
    )
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Fetch active pick batches failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch batches");
  }

  return batches || [];
}

export default async function StaffPickingPage() {
  let batches: PickBatch[] = [];
  let error: string | null = null;

  try {
    batches = await getActiveBatches();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load batches";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Picking"
        description="Select a batch to begin picking items for fulfillment."
        actions={<GeneratePickBatchButton />}
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No active pick batches. Use &ldquo;Generate pick batch&rdquo; above to create one from
          pending allocations at your store.
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => {
            const node = (batch.fulfillment_node as PickBatchFulfilmentNode[])?.[0];
            const lineCount = batch.pick_lines.length;
            const isInProgress = batch.status === "in_progress";

            return (
              <a
                key={batch.id}
                href={`/staff/picking/${batch.id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-semibold">{batch.id.slice(0, 8)}</div>
                      <StatusBadge
                        status={batch.status}
                        label={isInProgress ? "In Progress" : "Pending"}
                      />
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {node?.code} • {lineCount} items
                    </div>
                  </div>
                  <div className="ml-4 text-right text-xs text-muted-foreground">
                    {batch.started_at
                      ? new Date(batch.started_at).toLocaleTimeString("en-AU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : new Date(batch.created_at).toLocaleDateString("en-AU", {
                          month: "short",
                          day: "numeric",
                        })}
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
