"use client";

import { useState, useTransition } from "react";
import * as Sentry from "@sentry/nextjs";
import { PackagePlus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import {
  searchSellableSkus,
  receiveStock,
  listRecentReceipts,
  type SkuSearchResult,
  type ReceiptRow,
} from "@/features/staff/actions/manage-receiving";

const SELECT_CLASS = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function skuLabel(sku: SkuSearchResult): string {
  return [sku.finish, sku.condition, sku.language.toUpperCase()].filter(Boolean).join(" · ");
}

export function ReceivingWorkbench({
  nodes,
  initialReceipts,
}: {
  nodes: ScopedNode[];
  initialReceipts: ReceiptRow[];
}) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkuSearchResult[]>([]);
  const [selected, setSelected] = useState<SkuSearchResult | null>(null);
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isSaving, setIsSaving] = useState(false);

  function onSearch() {
    setError(null);
    startSearch(async () => {
      try {
        const found = await searchSellableSkus(query);
        setResults(found);
        if (found.length === 0) {
          setError(
            query.trim().length < 2
              ? "Enter at least two characters to search."
              : `No catalogue SKUs matching “${query}”.`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        Sentry.captureException(err);
      }
    });
  }

  async function onReceive() {
    if (!selected) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const result = await receiveStock({
        nodeId,
        skuId: selected.skuId,
        quantity: Number(quantity),
        reason: reason || undefined,
      });

      if (!result.success) {
        setError(result.error ?? "Receiving failed");
        return;
      }

      setNotice(`Received ${quantity} × ${selected.cardName} into stock.`);
      setSelected(null);
      setResults([]);
      setQuery("");
      setQuantity("");
      setReason("");
      setReceipts(await listRecentReceipts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receiving failed");
      Sentry.captureException(err);
    } finally {
      setIsSaving(false);
    }
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your staff membership does not grant access to any active fulfilment node.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-card p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <PackagePlus className="size-4 text-primary" aria-hidden />
          Book stock in
        </h2>

        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
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
              placeholder="Find a card to receive"
              aria-label="Search the catalogue by card name"
              className="h-10 pl-8"
            />
          </div>
          <Button type="submit" disabled={isSearching}>
            {isSearching ? "Searching…" : "Search catalogue"}
          </Button>
        </form>

        {results.length > 0 && !selected ? (
          <ul className="mt-4 divide-y rounded-lg border">
            {results.map((sku) => (
              <li key={sku.skuId}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(sku);
                    setError(null);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-muted/50"
                >
                  <span>
                    <span className="font-medium">{sku.cardName}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {sku.setCode.toUpperCase()} #{sku.collectorNumber} · {skuLabel(sku)}
                    </span>
                  </span>
                  <span className="text-xs text-primary">Select</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {selected ? (
          <div className="mt-4 space-y-4 rounded-lg bg-muted/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{selected.cardName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selected.setCode.toUpperCase()} #{selected.collectorNumber} ·{" "}
                  {skuLabel(selected)}
                </p>
              </div>
              <Button variant="outline" className="text-xs" onClick={() => setSelected(null)}>
                Change
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium">
                Receive into
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

              <label className="flex flex-col gap-1 text-xs font-medium">
                Quantity
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="w-28"
                />
              </label>

              <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                Reference / note (optional)
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. PO-4821, case break"
                />
              </label>

              <Button disabled={isSaving || quantity.trim() === ""} onClick={onReceive}>
                {isSaving ? "Receiving…" : "Receive"}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent receipts</h2>

        {receipts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No stock has been received at your stores yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-semibold">Card</th>
                  <th className="px-4 py-3 text-left font-semibold">Store</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty</th>
                  <th className="px-4 py-3 text-left font-semibold">Note</th>
                  <th className="px-4 py-3 text-left font-semibold">Received</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{receipt.cardName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {receipt.setCode.toUpperCase()} #{receipt.collectorNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{receipt.nodeName}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      +{receipt.quantity}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {receipt.reason ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatTimestamp(receipt.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
