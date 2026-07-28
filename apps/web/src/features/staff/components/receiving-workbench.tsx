"use client";

import { useId, useState, useTransition } from "react";
import * as Sentry from "@sentry/nextjs";
import { PackagePlus, Search, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import {
  searchSellableSkus,
  resolveSkusById,
  receiveStock,
  receiveStockBulk,
  listRecentReceipts,
  MAX_BULK_RECEIVE_LINES,
  type SkuSearchResult,
  type ReceiptRow,
} from "@/features/staff/actions/manage-receiving";
import { parseCsv } from "@/lib/csv";

const SELECT_CLASS = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

interface BatchLine extends SkuSearchResult {
  quantity: number;
  status?: "success" | "failed";
  error?: string;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function skuLabel(sku: SkuSearchResult): string {
  return [sku.finish, sku.condition, sku.language.toUpperCase()].filter(Boolean).join(" · ");
}

/**
 * Parses a bulk-receive CSV into raw (skuId, quantity) pairs. Expects a
 * header row containing `sku_id` and `quantity` columns (any order, extra
 * columns ignored) -- the CSV is expected to come from a supplier feed or a
 * catalogue export a staff member fills quantities into, not to be
 * hand-typed, so identifying by the internal SKU id (rather than trying to
 * fuzzy-match a card name/set/finish/condition combination from free text)
 * keeps resolution unambiguous.
 */
function parseBulkReceiveCsv(text: string): {
  lines: { skuId: string; quantity: number }[];
  rowErrors: string[];
} {
  const rows = parseCsv(text);
  const rowErrors: string[] = [];

  if (rows.length === 0) {
    return { lines: [], rowErrors: ["The file is empty."] };
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const skuIdCol = header.indexOf("sku_id");
  const quantityCol = header.indexOf("quantity");

  if (skuIdCol === -1 || quantityCol === -1) {
    return {
      lines: [],
      rowErrors: ['The first row must be a header containing "sku_id" and "quantity" columns.'],
    };
  }

  const lines: { skuId: string; quantity: number }[] = [];

  for (const [index, row] of rows.slice(1).entries()) {
    const lineNumber = index + 2; // +1 for the header, +1 for 1-indexing
    const skuId = row[skuIdCol]?.trim();
    const quantityRaw = row[quantityCol]?.trim();

    if (!skuId && !quantityRaw) {
      continue; // blank row
    }
    if (!skuId) {
      rowErrors.push(`Row ${lineNumber}: missing sku_id.`);
      continue;
    }
    const quantity = Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      rowErrors.push(`Row ${lineNumber}: "${quantityRaw}" is not a positive whole quantity.`);
      continue;
    }
    lines.push({ skuId, quantity });
  }

  return { lines, rowErrors };
}

export function ReceivingWorkbench({
  nodes,
  initialReceipts,
}: {
  nodes: ScopedNode[];
  initialReceipts: ReceiptRow[];
}) {
  const csvInputId = useId();
  const [receipts, setReceipts] = useState(initialReceipts);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkuSearchResult[]>([]);
  const [selected, setSelected] = useState<SkuSearchResult | null>(null);
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [batch, setBatch] = useState<BatchLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [csvNotice, setCsvNotice] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);

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

  function addSelectedToBatch() {
    if (!selected) return;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Enter a positive whole quantity before adding it to the batch.");
      return;
    }

    setBatch((current) => [...current, { ...selected, quantity: qty }]);
    setSelected(null);
    setResults([]);
    setQuery("");
    setQuantity("");
    setError(null);
    setNotice(null);
  }

  function removeBatchLine(index: number) {
    setBatch((current) => current.filter((_, i) => i !== index));
  }

  async function onReceiveSingle() {
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

  async function onCsvSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file after a fix
    if (!file) return;

    setCsvNotice(null);
    setError(null);
    setIsImportingCsv(true);

    try {
      const text = await file.text();
      const { lines, rowErrors } = parseBulkReceiveCsv(text);

      if (lines.length === 0) {
        setError(rowErrors[0] ?? "No usable rows found in that file.");
        return;
      }

      if (batch.length + lines.length > MAX_BULK_RECEIVE_LINES) {
        setError(
          `That file would bring the batch to ${batch.length + lines.length} lines, over the ${MAX_BULK_RECEIVE_LINES}-line limit. Submit the current batch first, or split the file.`,
        );
        return;
      }

      const resolved = await resolveSkusById(lines.map((l) => l.skuId));
      const bySkuId = new Map(resolved.map((sku) => [sku.skuId, sku]));

      const newLines: BatchLine[] = [];
      const unresolved: string[] = [];

      for (const line of lines) {
        const sku = bySkuId.get(line.skuId);
        if (!sku) {
          unresolved.push(line.skuId);
          continue;
        }
        newLines.push({ ...sku, quantity: line.quantity });
      }

      setBatch((current) => [...current, ...newLines]);

      const messages: string[] = [];
      if (newLines.length > 0) {
        messages.push(`Added ${newLines.length} line(s) from ${file.name}.`);
      }
      if (unresolved.length > 0) {
        messages.push(`${unresolved.length} SKU id(s) not found in the catalogue.`);
      }
      if (rowErrors.length > 0) {
        messages.push(`${rowErrors.length} row(s) skipped: ${rowErrors.slice(0, 3).join(" ")}`);
      }
      setCsvNotice(messages.join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
      Sentry.captureException(err);
    } finally {
      setIsImportingCsv(false);
    }
  }

  async function onReceiveBatch() {
    if (batch.length === 0) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const result = await receiveStockBulk({
        nodeId,
        lines: batch.map((line) => ({ skuId: line.skuId, quantity: line.quantity })),
        reason: reason || undefined,
      });

      if (result.lineResults) {
        const withStatus = batch.map((line, index) => {
          const lineResult = result.lineResults?.[index];
          return {
            ...line,
            status: lineResult?.success ? ("success" as const) : ("failed" as const),
            error: lineResult?.error,
          };
        });
        // Keep only the lines that failed so they can be reviewed and
        // resubmitted; successful ones are already in the ledger.
        setBatch(withStatus.filter((line) => line.status === "failed"));
      }

      const succeeded = result.lineResults?.filter((r) => r.success).length ?? 0;
      const total = result.lineResults?.length ?? batch.length;
      setNotice(`Received ${succeeded} of ${total} line(s) into stock.`);
      if (!result.success) {
        setError(result.error ?? "Some lines failed");
      }

      setReceipts(await listRecentReceipts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk receiving failed");
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

        <div className="mt-4 flex flex-wrap items-end gap-3">
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

          <label className="flex flex-1 min-w-48 flex-col gap-1 text-xs font-medium">
            Reference / note (optional, applies to this whole batch)
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. PO-4821, case break"
            />
          </label>
        </div>

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

              <Button
                variant="outline"
                disabled={quantity.trim() === ""}
                onClick={addSelectedToBatch}
              >
                Add to batch
              </Button>

              <Button disabled={isSaving || quantity.trim() === ""} onClick={onReceiveSingle}>
                {isSaving ? "Receiving…" : "Receive this line now"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <label htmlFor={csvInputId} className="text-xs font-medium">
            Or upload a shipment manifest (CSV with <code>sku_id</code>,{" "}
            <code>quantity</code> columns)
          </label>
          <Input
            id={csvInputId}
            type="file"
            accept=".csv,text/csv"
            disabled={isImportingCsv}
            onChange={onCsvSelected}
            className="w-auto"
          />
          {isImportingCsv ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Upload className="size-3.5 animate-pulse" aria-hidden /> Reading…
            </span>
          ) : null}
        </div>

        {csvNotice ? (
          <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            {csvNotice}
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

      {batch.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Pending batch ({batch.length})
            </h2>
            <Button disabled={isSaving} onClick={onReceiveBatch}>
              {isSaving ? "Receiving…" : `Receive batch (${batch.length})`}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-semibold">Card</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Remove</th>
                </tr>
              </thead>
              <tbody>
                {batch.map((line, index) => (
                  <tr key={`${line.skuId}-${index}`} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{line.cardName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {line.setCode.toUpperCase()} #{line.collectorNumber} · {skuLabel(line)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {line.quantity}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {line.status === "failed" ? (
                        <span className="text-destructive">{line.error ?? "Failed"}</span>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${line.cardName} from batch`}
                        onClick={() => removeBatchLine(index)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
