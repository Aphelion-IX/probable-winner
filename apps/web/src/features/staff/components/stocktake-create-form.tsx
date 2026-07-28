"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { ClipboardList, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import { createStocktake } from "@/features/staff/actions/manage-stocktakes";

const SELECT_CLASS = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

export function StocktakeCreateForm({ nodes }: { nodes: ScopedNode[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit() {
    setIsSaving(true);
    setError(null);

    try {
      const result = await createStocktake({ nodeId, notes: notes || undefined });

      if (!result.success || !result.stocktakeId) {
        setError(result.error ?? "Failed to create the stocktake");
        return;
      }

      router.push(`/staff/stocktakes/${result.stocktakeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the stocktake");
      Sentry.captureException(err);
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New stocktake
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <ClipboardList className="size-4 text-primary" aria-hidden />
        Start a new stocktake
      </h2>

      <p className="text-xs text-muted-foreground">
        Snapshots everything currently on hand at the chosen store as the expected quantity. You
        then count and enter what&apos;s actually there — any difference is reconciled to the
        inventory ledger automatically once you mark the count complete.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Store
          <select
            value={nodeId}
            onChange={(event) => setNodeId(event.target.value)}
            className={SELECT_CLASS}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 min-w-48 flex-col gap-1 text-xs font-medium">
          Notes (optional)
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Quarterly full count"
          />
        </label>

        <Button disabled={isSaving || !nodeId} onClick={onSubmit}>
          {isSaving ? "Creating…" : "Create stocktake"}
        </Button>
        <Button variant="outline" disabled={isSaving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
