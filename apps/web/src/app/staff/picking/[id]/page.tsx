"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { getPickBatch, type PickBatchDetail } from "@/features/staff/actions/get-pick-batch";
import { recordPickException, getPickLineExceptions, type PickException } from "@/features/staff/actions/handle-pick-exception";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function PickBatchPage() {
  const params = useParams();
  const batchId = params.id as string;

  const [batch, setBatch] = useState<PickBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [scannedSkus, setScannedSkus] = useState<Set<string>>(new Set());
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [lineExceptions, setLineExceptions] = useState<Map<string, PickException[]>>(new Map());
  const [exceptionType, setExceptionType] = useState<string>("");
  const [exceptionNotes, setExceptionNotes] = useState<string>("");
  const [showExceptionForm, setShowExceptionForm] = useState<string | null>(null);

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

  const loadLineExceptions = async (lineId: string) => {
    try {
      const exceptions = await getPickLineExceptions(lineId);
      setLineExceptions((prev) => new Map([...prev, [lineId, exceptions]]));
    } catch (err) {
      console.error("Failed to load exceptions:", err);
      Sentry.captureException(err);
    }
  };

  const handleRecordException = async (lineId: string) => {
    if (!exceptionType.trim()) return;

    try {
      await recordPickException(lineId, exceptionType, exceptionNotes || undefined);
      setExceptionType("");
      setExceptionNotes("");
      setShowExceptionForm(null);
      await loadLineExceptions(lineId);
    } catch (err) {
      console.error("Failed to record exception:", err);
      Sentry.captureException(err);
    }
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
              const isExpanded = expandedLineId === line.id;
              const hasExceptions = lineExceptions.get(line.id)?.length ?? 0 > 0;

              return (
                <div key={line.id} className="space-y-0">
                  <button
                    onClick={() => {
                      setExpandedLineId(isExpanded ? null : line.id);
                      if (!isExpanded && !lineExceptions.has(line.id)) {
                        loadLineExceptions(line.id);
                      }
                    }}
                    className={`w-full rounded-lg border p-4 transition-colors text-left ${
                      isFilled
                        ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
                        : isPartial
                          ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
                          : isScanned
                            ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
                            : hasExceptions
                              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
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
                          {hasExceptions && <Badge className="bg-red-600">Exceptions</Badge>}
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
                  </button>

                  {isExpanded && (
                    <div className="rounded-b-lg border border-t-0 border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900 space-y-3">
                      {hasExceptions && (
                        <div className="space-y-2">
                          <div className="text-sm font-semibold">Exceptions</div>
                          {lineExceptions.get(line.id)?.map((exc) => (
                            <div
                              key={exc.id}
                              className="rounded bg-white dark:bg-gray-800 p-2 text-xs border-l-4 border-red-500"
                            >
                              <div className="font-medium">{exc.exception_type.name}</div>
                              {exc.notes && <div className="text-muted-foreground mt-1">{exc.notes}</div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {showExceptionForm !== line.id ? (
                        <Button
                          onClick={() => setShowExceptionForm(line.id)}
                          className="w-full text-sm"
                          variant="outline"
                        >
                          + Report Exception
                        </Button>
                      ) : (
                        <div className="space-y-2 bg-white dark:bg-gray-800 p-3 rounded">
                          <div>
                            <label className="block text-xs font-medium mb-1">Exception Type</label>
                            <select
                              value={exceptionType}
                              onChange={(e) => setExceptionType(e.target.value)}
                              className="w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
                            >
                              <option value="">Select...</option>
                              <option value="missing_card">Card Missing</option>
                              <option value="condition_mismatch">Condition Mismatch</option>
                              <option value="wrong_edition">Wrong Edition</option>
                              <option value="damaged_in_picking">Damaged During Pick</option>
                              <option value="substitution_offered">Substitution Offered</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Notes (optional)</label>
                            <textarea
                              value={exceptionNotes}
                              onChange={(e) => setExceptionNotes(e.target.value)}
                              placeholder="Details about the exception..."
                              className="w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
                              rows={2}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleRecordException(line.id)}
                              className="flex-1 text-xs"
                            >
                              Record
                            </Button>
                            <Button
                              onClick={() => {
                                setShowExceptionForm(null);
                                setExceptionType("");
                                setExceptionNotes("");
                              }}
                              variant="outline"
                              className="flex-1 text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
