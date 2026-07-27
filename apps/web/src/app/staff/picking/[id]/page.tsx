"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { getPickBatch, type PickBatchDetail } from "@/features/staff/actions/get-pick-batch";
import {
  recordPickException,
  getPickLineExceptions,
  type PickException,
} from "@/features/staff/actions/handle-pick-exception";
import {
  beginPickBatch,
  recordPickLineScan,
  completePickBatch,
} from "@/features/staff/actions/record-pick-scan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/staff/status-badge";

export default function PickBatchPage() {
  const params = useParams();
  const batchId = params.id as string;

  const [batch, setBatch] = useState<PickBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickingLineId, setPickingLineId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [lineExceptions, setLineExceptions] = useState<Map<string, PickException[]>>(new Map());
  const [exceptionType, setExceptionType] = useState<string>("");
  const [exceptionNotes, setExceptionNotes] = useState<string>("");
  const [showExceptionForm, setShowExceptionForm] = useState<string | null>(null);
  const beganBatch = useRef(false);

  async function loadBatch() {
    try {
      const data = await getPickBatch(batchId);
      setBatch(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load batch");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      await loadBatch();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  // A pending batch has no separate "Start" step in this UI -- opening its
  // detail page is what begins it (backlog B-142), which also moves every
  // order the batch covers from 'paid' to 'picking'.
  useEffect(() => {
    if (batch?.status === "pending" && !beganBatch.current) {
      beganBatch.current = true;
      beginPickBatch(batchId)
        .then((result) => {
          if (!result.success) {
            setError(result.error);
            return;
          }
          return loadBatch();
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to begin batch");
          Sentry.captureException(err);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.status, batchId]);

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

  async function handleMarkPicked(lineId: string) {
    setPickError(null);
    setPickingLineId(lineId);
    try {
      const result = await recordPickLineScan(lineId);
      if (!result.success) {
        setPickError(result.error);
        return;
      }
      await loadBatch();
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "Failed to record pick");
      Sentry.captureException(err);
    } finally {
      setPickingLineId(null);
    }
  }

  async function handleCompleteBatch() {
    setPickError(null);
    setCompleting(true);
    try {
      const result = await completePickBatch(batchId);
      if (!result.success) {
        setPickError(result.error);
        return;
      }
      await loadBatch();
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "Failed to complete batch");
      Sentry.captureException(err);
    } finally {
      setCompleting(false);
    }
  }

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
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error || "Batch not found"}
      </div>
    );
  }

  const progress = batch.total_items > 0 ? (batch.picked_items / batch.total_items) * 100 : 0;
  const allPicked = batch.total_lines > 0 && batch.picked_items === batch.total_items;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Pick Batch</h1>
          <StatusBadge status={batch.status} />
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
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {pickError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {pickError}
        </div>
      ) : null}

      {batch.status === "completed" ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          This batch is complete. It&rsquo;s now ready to pack from the{" "}
          <Link href="/staff/packing" className="font-medium underline">
            Packing
          </Link>{" "}
          screen.
        </div>
      ) : allPicked ? (
        <Button onClick={handleCompleteBatch} disabled={completing} className="w-full">
          {completing ? "Completing…" : "Complete pick"}
        </Button>
      ) : null}

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
              const isExpanded = expandedLineId === line.id;
              const hasExceptions = lineExceptions.get(line.id)?.length ?? 0 > 0;

              return (
                <div key={line.id} className="space-y-0">
                  <div
                    className={`w-full rounded-lg border p-4 transition-colors ${
                      isFilled
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : isPartial
                          ? "border-primary/30 bg-primary/5"
                          : hasExceptions
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-border bg-card"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setExpandedLineId(isExpanded ? null : line.id);
                        if (!isExpanded && !lineExceptions.has(line.id)) {
                          loadLineExceptions(line.id);
                        }
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-muted-foreground">
                              {line.order_number}
                            </span>
                            <span className="text-sm font-medium">{line.card_name}</span>
                            {hasExceptions && <Badge variant="destructive">Exceptions</Badge>}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {line.set_code} #{line.collector_number} • {line.finish} •{" "}
                            {line.language}
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
                                      ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                      : "font-semibold text-amber-600 dark:text-amber-400"
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

                    {!isFilled && batch.status === "in_progress" && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkPicked(line.id);
                        }}
                        disabled={pickingLineId === line.id}
                        className="mt-3 w-full"
                      >
                        {pickingLineId === line.id ? "Recording…" : "Mark 1 as picked"}
                      </Button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 rounded-b-lg border border-t-0 bg-muted/30 p-4">
                      {hasExceptions && (
                        <div className="space-y-2">
                          <div className="text-sm font-semibold">Exceptions</div>
                          {lineExceptions.get(line.id)?.map((exc) => (
                            <div
                              key={exc.id}
                              className="rounded border-l-4 border-destructive bg-card p-2 text-xs"
                            >
                              <div className="font-medium">{exc.exception_type.name}</div>
                              {exc.notes && (
                                <div className="text-muted-foreground mt-1">{exc.notes}</div>
                              )}
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
                        <div className="space-y-2 rounded-lg bg-card p-3">
                          <div>
                            <label className="block text-xs font-medium mb-1">Exception Type</label>
                            <select
                              value={exceptionType}
                              onChange={(e) => setExceptionType(e.target.value)}
                              className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs"
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
                            <label className="block text-xs font-medium mb-1">
                              Notes (optional)
                            </label>
                            <textarea
                              value={exceptionNotes}
                              onChange={(e) => setExceptionNotes(e.target.value)}
                              placeholder="Details about the exception..."
                              className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs"
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
