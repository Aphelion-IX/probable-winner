"use client";

import { useState, useTransition } from "react";
import * as Sentry from "@sentry/nextjs";
import { Search, ShieldAlert, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import {
  searchInventory,
  listQuarantinedStock,
  adjustStock,
  quarantineStock,
  releaseQuarantine,
  type InventoryRow,
  type QuarantineRow,
} from "@/features/staff/actions/manage-inventory";
import {
  ADJUSTMENT_MOVEMENT_TYPES,
  type AdjustmentMovementType,
} from "@/features/staff/inventory-movement-types";

const SELECT_CLASS = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

type DraftMode = "adjust" | "quarantine";

interface Draft {
  rowId: string;
  mode: DraftMode;
  quantity: string;
  reason: string;
  movementType: AdjustmentMovementType;
}

function skuLabel(row: InventoryRow): string {
  return [row.finish, row.condition, row.language.toUpperCase()].filter(Boolean).join(" · ");
}

export function InventoryWorkbench({
  nodes,
  initialRows,
  initialQuarantined,
}: {
  nodes: ScopedNode[];
  initialRows: InventoryRow[];
  initialQuarantined: QuarantineRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [quarantined, setQuarantined] = useState(initialQuarantined);
  const [query, setQuery] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  function runSearch(nextQuery: string, nextNodeId: string) {
    setError(null);
    startSearch(async () => {
      try {
        const results = await searchInventory({
          query: nextQuery,
          nodeId: nextNodeId || undefined,
        });
        setRows(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        Sentry.captureException(err);
      }
    });
  }

  // Both writes need the same follow-up: refresh the balance list and the
  // quarantine list, since quarantining moves quantity between them.
  async function refreshAll() {
    const [nextRows, nextQuarantined] = await Promise.all([
      searchInventory({ query, nodeId: nodeId || undefined }),
      listQuarantinedStock(),
    ]);
    setRows(nextRows);
    setQuarantined(nextQuarantined);
  }

  async function submitDraft(row: InventoryRow) {
    if (!draft) return;

    const quantity = Number(draft.quantity);
    setPendingRowId(row.id);
    setError(null);
    setNotice(null);

    try {
      const result =
        draft.mode === "adjust"
          ? await adjustStock({
              nodeId: row.nodeId,
              skuId: row.skuId,
              movementType: draft.movementType,
              quantityDelta: quantity,
              reason: draft.reason,
            })
          : await quarantineStock({
              nodeId: row.nodeId,
              skuId: row.skuId,
              quantity,
              reason: draft.reason,
            });

      if (!result.success) {
        setError(result.error ?? "Action failed");
        return;
      }

      setNotice(
        draft.mode === "adjust"
          ? `Adjusted ${row.cardName} by ${quantity > 0 ? "+" : ""}${quantity}.`
          : `Quarantined ${quantity} × ${row.cardName}.`,
      );
      setDraft(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      Sentry.captureException(err);
    } finally {
      setPendingRowId(null);
    }
  }

  async function onRelease(item: QuarantineRow) {
    setPendingRowId(item.id);
    setError(null);
    setNotice(null);

    try {
      const result = await releaseQuarantine(item.id);
      if (!result.success) {
        setError(result.error ?? "Release failed");
        return;
      }
      setNotice(`Released ${item.quantity} × ${item.cardName} back to sellable stock.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed");
      Sentry.captureException(err);
    } finally {
      setPendingRowId(null);
    }
  }

  function openDraft(row: InventoryRow, mode: DraftMode) {
    setNotice(null);
    setError(null);
    setDraft(
      draft?.rowId === row.id && draft.mode === mode
        ? null
        : {
            rowId: row.id,
            mode,
            quantity: "",
            reason: "",
            movementType: "stocktake_adjustment",
          },
    );
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
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(query, nodeId);
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
            placeholder="Search by card name"
            aria-label="Search inventory by card name"
            className="h-10 pl-8"
          />
        </div>
        <select
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value);
            runSearch(query, event.target.value);
          }}
          aria-label="Filter by fulfilment node"
          className={SELECT_CLASS}
        >
          <option value="">All my stores</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isSearching}>
          {isSearching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query ? `No stock matching “${query}”.` : "No stock on hand in your scope."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold">Card</th>
                <th className="px-4 py-3 text-left font-semibold">Store</th>
                <th className="px-4 py-3 text-right font-semibold">On hand</th>
                <th className="px-4 py-3 text-right font-semibold">Reserved</th>
                <th className="px-4 py-3 text-right font-semibold">Allocated</th>
                <th className="px-4 py-3 text-right font-semibold">Available</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.cardName}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {row.setCode.toUpperCase()} #{row.collectorNumber} · {skuLabel(row)}
                    </div>
                    {draft?.rowId === row.id ? (
                      <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3">
                        <p className="text-xs font-semibold">
                          {draft.mode === "adjust" ? "Adjust count" : "Quarantine stock"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {draft.mode === "adjust" ? (
                            <select
                              value={draft.movementType}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  movementType: event.target.value as AdjustmentMovementType,
                                })
                              }
                              aria-label="Adjustment type"
                              className={SELECT_CLASS}
                            >
                              {ADJUSTMENT_MOVEMENT_TYPES.map((type) => (
                                <option key={type.value} value={type.value}>
                                  {type.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <Input
                            type="number"
                            step="1"
                            value={draft.quantity}
                            onChange={(event) =>
                              setDraft({ ...draft, quantity: event.target.value })
                            }
                            placeholder={draft.mode === "adjust" ? "+/- qty" : "Qty"}
                            aria-label={draft.mode === "adjust" ? "Quantity delta" : "Quantity"}
                            className="w-28"
                          />
                          <Input
                            value={draft.reason}
                            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                            placeholder="Reason (required)"
                            aria-label="Reason"
                            className="w-56"
                          />
                          <Button
                            disabled={
                              pendingRowId === row.id ||
                              draft.quantity.trim() === "" ||
                              draft.reason.trim() === ""
                            }
                            onClick={() => submitDraft(row)}
                          >
                            {pendingRowId === row.id ? "Saving…" : "Confirm"}
                          </Button>
                          <Button variant="outline" onClick={() => setDraft(null)}>
                            Cancel
                          </Button>
                        </div>
                        {draft.mode === "adjust" ? (
                          <p className="text-xs text-muted-foreground">
                            Use a negative number to remove stock. Recorded in the movement ledger
                            against your account.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs">{row.nodeName}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{row.onHand}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {row.reserved}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {row.allocated}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {row.availableOnline}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        className="text-xs"
                        onClick={() => openDraft(row, "adjust")}
                      >
                        Adjust
                      </Button>
                      <Button
                        variant="outline"
                        className="text-xs"
                        onClick={() => openDraft(row, "quarantine")}
                      >
                        Quarantine
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight">Quarantined stock</h2>
          {quarantined.length > 0 ? <Badge variant="warning">{quarantined.length}</Badge> : null}
        </div>

        {quarantined.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing is quarantined in your scope.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-semibold">Card</th>
                  <th className="px-4 py-3 text-left font-semibold">Store</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty</th>
                  <th className="px-4 py-3 text-left font-semibold">Reason</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {quarantined.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.cardName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {item.setCode.toUpperCase()} #{item.collectorNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{item.nodeName}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.reason}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        className="text-xs"
                        disabled={pendingRowId === item.id}
                        onClick={() => onRelease(item)}
                      >
                        <Undo2 className="size-3.5" aria-hidden />
                        {pendingRowId === item.id ? "Releasing…" : "Release"}
                      </Button>
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
