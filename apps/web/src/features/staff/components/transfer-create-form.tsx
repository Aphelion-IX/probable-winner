"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import { searchSellableSkus, type SkuSearchResult } from "@/features/staff/actions/manage-receiving";
import { createTransferOrder } from "@/features/staff/actions/manage-transfers";

const SELECT_CLASS = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

interface DraftLine extends SkuSearchResult {
  quantity: string;
}

export function TransferCreateForm({ nodes }: { nodes: ScopedNode[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceNodeId, setSourceNodeId] = useState(nodes[0]?.id ?? "");
  const [destinationNodeId, setDestinationNodeId] = useState(nodes[1]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkuSearchResult[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isSaving, setIsSaving] = useState(false);

  function onSearch() {
    setError(null);
    startSearch(async () => {
      try {
        setResults(await searchSellableSkus(query));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        Sentry.captureException(err);
      }
    });
  }

  function addLine(sku: SkuSearchResult) {
    if (lines.some((line) => line.skuId === sku.skuId)) return;
    setLines([...lines, { ...sku, quantity: "1" }]);
    setResults([]);
    setQuery("");
  }

  async function onSubmit() {
    setIsSaving(true);
    setError(null);

    try {
      const result = await createTransferOrder({
        sourceNodeId,
        destinationNodeId,
        notes: notes || undefined,
        lines: lines.map((line) => ({ skuId: line.skuId, quantity: Number(line.quantity) })),
      });

      if (!result.success) {
        setError(result.error ?? "Failed to create the transfer");
        return;
      }

      setOpen(false);
      setLines([]);
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the transfer");
      Sentry.captureException(err);
    } finally {
      setIsSaving(false);
    }
  }

  if (nodes.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        A transfer needs two stores in your scope; you currently have {nodes.length}.
      </p>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New transfer
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">New transfer</h2>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          From
          <select
            value={sourceNodeId}
            onChange={(event) => setSourceNodeId(event.target.value)}
            className={SELECT_CLASS}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          To
          <select
            value={destinationNodeId}
            onChange={(event) => setDestinationNodeId(event.target.value)}
            className={SELECT_CLASS}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
          Notes (optional)
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. rebalancing singles for weekend event"
          />
        </label>
      </div>

      <form
        className="flex gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Add a card to this transfer"
            aria-label="Search the catalogue by card name"
            className="h-10 pl-8"
          />
        </div>
        <Button type="submit" variant="outline" disabled={isSearching}>
          {isSearching ? "Searching…" : "Search"}
        </Button>
      </form>

      {results.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {results.map((sku) => (
            <li key={sku.skuId}>
              <button
                type="button"
                onClick={() => addLine(sku)}
                className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
              >
                <span>
                  <span className="font-medium">{sku.cardName}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {sku.setCode.toUpperCase()} #{sku.collectorNumber} · {sku.finish} ·{" "}
                    {sku.condition}
                  </span>
                </span>
                <span className="text-xs text-primary">Add</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {lines.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {lines.map((line, index) => (
            <li key={line.skuId} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 text-sm">
                <span className="font-medium">{line.cardName}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {line.setCode.toUpperCase()} #{line.collectorNumber} · {line.finish} ·{" "}
                  {line.condition}
                </span>
              </span>
              <Input
                type="number"
                min="1"
                step="1"
                value={line.quantity}
                aria-label={`Quantity for ${line.cardName}`}
                onChange={(event) => {
                  const next = [...lines];
                  next[index] = { ...line, quantity: event.target.value };
                  setLines(next);
                }}
                className="w-24"
              />
              <Button
                variant="ghost"
                aria-label={`Remove ${line.cardName}`}
                onClick={() => setLines(lines.filter((other) => other.skuId !== line.skuId))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button disabled={isSaving || lines.length === 0} onClick={onSubmit}>
          {isSaving ? "Creating…" : "Create draft transfer"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
