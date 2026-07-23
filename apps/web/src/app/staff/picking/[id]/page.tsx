"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPickBatch, type PickBatchDetail } from "@/features/staff/actions/get-pick-batch";
import { Badge } from "@/components/ui/badge";

export default function PickBatchPage() {
  const params = useParams();
  const batchId = params.id as string;

  const [batch, setBatch] = useState<PickBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [scannedSkus, setScannedSkus] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadBatch() {
      try {
        const data = await getPickBatch(batchId);
        setBatch(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load batch");
      } finally {
        setLoading(false);
      }
    }

    loadBatch();
  }, [batchId]);

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();

    if (!scanInput.trim()) return;

    // In a real implementation, this would:
    // 1. Look up the SKU by barcode
    // 2. Find matching pick lines
    // 3. Mark them as picked
    // 4. Call a Server Action to update database

    setScannedSkus((prev) => new Set([...prev, scanInput]));
    setScanInput("");
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-32 animate-pulse rounded bg-muted"></div>
        <div className="h-4 w-64 animate-pulse rounded bg-muted"></div>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
        {error || "Batch not found"}
      </div>
    );
  }

  const progress = batch.total_items > 0 ? (batch.picked_items / batch.total_items) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Pick Batch</h1>
          <Badge
            className={
              batch.status === "in_progress"
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                : batch.status === "completed"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                  : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
            }
          >
            {batch.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {batch.node_name} • {batch.total_lines} items • {batch.completed_lines} of{" "}
          {batch.total_lines} complete
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground">
            {batch.picked_items} of {batch.total_items} items
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-green-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Scan input */}
      {batch.status !== "completed" && (
        <form onSubmit={handleScan} className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div>
            <label className="block text-sm font-medium mb-2">Scan SKU barcode</label>
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Scan or type SKU..."
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:placeholder-gray-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
          >
            Mark as Picked
          </button>
        </form>
      )}

      {/* Pick lines */}
      <div className="space-y-3">
        {batch.pick_lines.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No items in this batch
          </div>
        ) : (
          batch.pick_lines
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((line) => {
              const isFilled = line.quantity_picked === line.quantity_to_pick;
              const isPartial = line.quantity_picked > 0 && !isFilled;
              const isScanned = scannedSkus.has(line.sku_id);

              return (
                <div
                  key={line.id}
                  className={`rounded-lg border p-4 transition-colors ${
                    isFilled
                      ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
                      : isPartial
                        ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
                        : isScanned
                          ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
                          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                  }`}
                >
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
                      <div className="mt-2 text-sm">
                        <span className="font-medium">Expected:</span> {line.expected_condition}
                        {line.condition_confirmed && (
                          <>
                            {" "}
                            →{" "}
                            <span
                              className={
                                line.condition_confirmed === "match"
                                  ? "text-green-600 font-semibold"
                                  : "text-orange-600 font-semibold"
                              }
                            >
                              {line.condition_confirmed}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">
                        {line.quantity_picked}/{line.quantity_to_pick}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {line.scan_count > 0 && `scanned ${line.scan_count}x`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
