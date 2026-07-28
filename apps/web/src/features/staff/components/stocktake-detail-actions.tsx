"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { CheckCircle2, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  updateLineCount,
  completeStocktake,
  type StocktakeDetail,
  type StocktakeLine,
} from "@/features/staff/actions/manage-stocktakes";

function VarianceCell({ variance }: { variance: number | null }) {
  if (variance === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (variance === 0) {
    return (
      <span className="flex items-center justify-end gap-1 text-muted-foreground">
        <Minus className="size-3.5" aria-hidden />0
      </span>
    );
  }
  const positive = variance > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span
      className={
        positive
          ? "flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400"
          : "flex items-center justify-end gap-1 text-destructive"
      }
    >
      <Icon className="size-3.5" aria-hidden />
      {positive ? `+${variance}` : variance}
    </span>
  );
}

export function StocktakeDetailActions({ stocktake }: { stocktake: StocktakeDetail }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const editable = stocktake.status === "draft" || stocktake.status === "in_progress";
  const uncounted = stocktake.lines.filter((line) => line.countedQuantity === null).length;

  function draftFor(line: StocktakeLine): string {
    if (line.id in drafts) return drafts[line.id];
    return line.countedQuantity === null ? "" : String(line.countedQuantity);
  }

  async function saveCount(line: StocktakeLine, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);

    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setError("Enter a whole number of zero or more, or leave it blank to clear the count.");
      return;
    }

    // Nothing changed -- most blurs are just tabbing through, not edits.
    if (value === line.countedQuantity) return;

    setSavingLineId(line.id);
    setError(null);

    try {
      const result = await updateLineCount(line.id, value);
      if (!result.success) {
        setError(result.error ?? "Failed to save that count");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save that count");
      Sentry.captureException(err);
    } finally {
      setSavingLineId(null);
    }
  }

  async function onComplete() {
    setIsCompleting(true);
    setError(null);

    try {
      const result = await completeStocktake(stocktake.id);
      if (!result.success) {
        setError(result.error ?? "Failed to complete the stocktake");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the stocktake");
      Sentry.captureException(err);
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {editable ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div className="text-sm">
            {uncounted > 0 ? (
              <p className="text-amber-600 dark:text-amber-400">
                {uncounted} of {stocktake.lines.length} line(s) not yet counted. Completing now
                leaves them out of reconciliation.
              </p>
            ) : (
              <p className="text-muted-foreground">Every line has a count entered.</p>
            )}
          </div>
          <Button disabled={isCompleting} onClick={onComplete}>
            {isCompleting
              ? "Completing…"
              : uncounted > 0
                ? `Complete anyway (${uncounted} uncounted)`
                : "Complete stocktake"}
          </Button>
        </div>
      ) : stocktake.status === "completed" ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Completed — reconciliation runs in the background and will update each line below to
          &quot;reconciled&quot; shortly. Refresh this page to check progress.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden />
          Reconciled — every counted variance has been written to the inventory ledger.
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-semibold">Card</th>
              <th className="px-4 py-3 text-right font-semibold">Expected</th>
              <th className="px-4 py-3 text-right font-semibold">Counted</th>
              <th className="px-4 py-3 text-right font-semibold">Variance</th>
              <th className="px-4 py-3 text-left font-semibold">Ledger</th>
            </tr>
          </thead>
          <tbody>
            {stocktake.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-b-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{line.cardName}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {line.setCode.toUpperCase()} #{line.collectorNumber} · {line.finish} ·{" "}
                    {line.condition}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {line.expectedQuantity}
                </td>
                <td className="px-4 py-3 text-right">
                  {editable ? (
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={draftFor(line)}
                      disabled={savingLineId === line.id}
                      aria-label={`Counted quantity for ${line.cardName}`}
                      onChange={(event) => setDrafts({ ...drafts, [line.id]: event.target.value })}
                      onBlur={(event) => saveCount(line, event.target.value)}
                      className="w-24 text-right"
                    />
                  ) : (
                    <span className="tabular-nums">{line.countedQuantity ?? "—"}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <VarianceCell variance={line.variance} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {line.reconciled ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" aria-hidden /> Reconciled
                    </span>
                  ) : line.countedQuantity === null ? (
                    "Not counted"
                  ) : (
                    "Pending"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
