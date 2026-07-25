"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  updateTransferStatus,
  dispatchTransfer,
  receiveTransfer,
  type TransferDetail,
} from "@/features/staff/actions/manage-transfers";

/**
 * The next plain status a transfer can advance to by hand, mirroring
 * enforce_transfer_status_transition() in
 * 20260723064323_transfer_schema.sql. Dispatch and receipt are absent on
 * purpose — they move stock, so they go through their own RPCs below.
 */
const NEXT_STATUS: Record<string, { status: string; label: string } | undefined> = {
  draft: { status: "requested", label: "Submit request" },
  requested: { status: "accepted", label: "Accept" },
  accepted: { status: "picking", label: "Start picking" },
  dispatched: { status: "in_transit", label: "Mark in transit" },
};

const CANCELLABLE = new Set(["draft", "requested", "accepted", "picking"]);
const RECEIVABLE = new Set(["dispatched", "in_transit", "partially_received"]);

interface ReceiptDraft {
  good: string;
  damaged: string;
  missing: string;
}

export function TransferDetailActions({ transfer }: { transfer: TransferDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({});

  async function run(key: string, action: () => Promise<{ success: boolean; error?: string }>) {
    setPending(key);
    setError(null);

    try {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? "Action failed");
        return;
      }
      setReceiving(false);
      setDrafts({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      Sentry.captureException(err);
    } finally {
      setPending(null);
    }
  }

  function draftFor(skuId: string): ReceiptDraft {
    return drafts[skuId] ?? { good: "", damaged: "", missing: "" };
  }

  function setDraftField(skuId: string, field: keyof ReceiptDraft, value: string) {
    setDrafts({ ...drafts, [skuId]: { ...draftFor(skuId), [field]: value } });
  }

  const next = NEXT_STATUS[transfer.status];
  const canDispatch = transfer.status === "picking";
  const canReceive = RECEIVABLE.has(transfer.status);
  const outstandingLines = transfer.lines.filter((line) => line.quantityOutstanding > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {next ? (
          <Button
            disabled={pending !== null}
            onClick={() => run("advance", () => updateTransferStatus(transfer.id, next.status))}
          >
            {pending === "advance" ? "Saving…" : next.label}
          </Button>
        ) : null}

        {canDispatch ? (
          <Button
            disabled={pending !== null}
            onClick={() => run("dispatch", () => dispatchTransfer(transfer.id))}
          >
            {pending === "dispatch" ? "Dispatching…" : "Dispatch"}
          </Button>
        ) : null}

        {canReceive && outstandingLines.length > 0 ? (
          <Button variant="outline" onClick={() => setReceiving(!receiving)}>
            {receiving ? "Cancel receipt" : "Receive stock"}
          </Button>
        ) : null}

        {CANCELLABLE.has(transfer.status) ? (
          <Button
            variant="outline"
            disabled={pending !== null}
            onClick={() => run("cancel", () => updateTransferStatus(transfer.id, "cancelled"))}
          >
            {pending === "cancel" ? "Cancelling…" : "Cancel transfer"}
          </Button>
        ) : null}
      </div>

      {canDispatch ? (
        <p className="text-xs text-muted-foreground">
          Dispatching removes every line&rsquo;s full quantity from{" "}
          <span className="font-medium">{transfer.sourceNodeName}</span>. It cannot be undone.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {receiving ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">
            Count what arrived at {transfer.destinationNodeName}
          </h3>
          <p className="text-xs text-muted-foreground">
            Only good stock becomes sellable. Damaged and missing are recorded against the transfer
            so the discrepancy stays visible. Leave a line blank to receive it later.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-semibold">Card</th>
                  <th className="px-2 py-2 text-right font-semibold">Outstanding</th>
                  <th className="px-2 py-2 text-right font-semibold">Good</th>
                  <th className="px-2 py-2 text-right font-semibold">Damaged</th>
                  <th className="px-2 py-2 text-right font-semibold">Missing</th>
                </tr>
              </thead>
              <tbody>
                {outstandingLines.map((line) => (
                  <tr key={line.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2">
                      <div className="font-medium">{line.cardName}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.setCode.toUpperCase()} #{line.collectorNumber}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {line.quantityOutstanding}
                    </td>
                    {(["good", "damaged", "missing"] as const).map((field) => (
                      <td key={field} className="px-2 py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={draftFor(line.skuId)[field]}
                          aria-label={`${field} quantity for ${line.cardName}`}
                          onChange={(event) =>
                            setDraftField(line.skuId, field, event.target.value)
                          }
                          className="w-20"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button
            disabled={pending !== null}
            onClick={() =>
              run("receive", () =>
                receiveTransfer(
                  transfer.id,
                  outstandingLines.map((line) => ({
                    skuId: line.skuId,
                    good: Number(draftFor(line.skuId).good) || 0,
                    damaged: Number(draftFor(line.skuId).damaged) || 0,
                    missing: Number(draftFor(line.skuId).missing) || 0,
                  })),
                ),
              )
            }
          >
            {pending === "receive" ? "Recording…" : "Record receipt"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
