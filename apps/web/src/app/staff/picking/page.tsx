import { createServerSupabaseClient } from "@/server/supabase";

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
    console.error("Batches query error:", error);
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Picking</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Select a batch to begin picking items for fulfillment.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No active pick batches. Generate a batch from the Orders dashboard.
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
                className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-semibold">{batch.id.slice(0, 8)}</div>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          isInProgress
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
                        }`}
                      >
                        {batch.status === "in_progress" ? "In Progress" : "Pending"}
                      </span>
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
