"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adjustCustomerCredit,
  CREDIT_ENTRY_TYPES,
  DEBIT_ENTRY_TYPES,
  type StoreCreditAccount,
  type StoreCreditLedgerEntry,
} from "@/features/staff/actions/manage-store-credit";

const SELECT_CLASS = "rounded-lg border border-input bg-background px-3 py-2 text-xs";

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(amount);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function StoreCreditPanel({
  customerId,
  canManage,
  account,
  ledger,
  onChanged,
}: {
  customerId: string;
  /** Whether the viewing staff member holds customers.credit -- when false, the balance/history still render, just without the add/remove form. */
  canManage: boolean;
  account: StoreCreditAccount;
  ledger: StoreCreditLedgerEntry[];
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState<string>(CREDIT_ENTRY_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const typeOptions = mode === "add" ? CREDIT_ENTRY_TYPES : DEBIT_ENTRY_TYPES;

  function switchMode(next: "add" | "remove") {
    setMode(next);
    setEntryType(next === "add" ? CREDIT_ENTRY_TYPES[0].value : DEBIT_ENTRY_TYPES[0].value);
    setError(null);
    setNotice(null);
  }

  async function onSubmit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive amount");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required");
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const result = await adjustCustomerCredit({
        customerId,
        amountDelta: mode === "add" ? parsed : -parsed,
        entryType,
        reason,
      });

      if (!result.success) {
        setError(result.error ?? "Failed to update store credit");
        return;
      }

      setNotice(
        mode === "add"
          ? `Added ${formatMoney(parsed, account.currency)} store credit.`
          : `Removed ${formatMoney(parsed, account.currency)} store credit.`,
      );
      setAmount("");
      setReason("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update store credit");
      Sentry.captureException(err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4 text-primary" aria-hidden />
          Store credit
        </h3>
        <span className="text-lg font-semibold tabular-nums">
          {formatMoney(account.balance, account.currency)}
        </span>
      </div>

      {canManage ? (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div
            role="group"
            aria-label="Credit direction"
            className="inline-flex w-fit rounded-full border p-0.5 text-xs font-medium"
          >
            <button
              type="button"
              aria-pressed={mode === "add"}
              onClick={() => switchMode("add")}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                mode === "add"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Add credit
            </button>
            <button
              type="button"
              aria-pressed={mode === "remove"}
              onClick={() => switchMode("remove")}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                mode === "remove"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Remove credit
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Amount
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-28"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Type
              <select
                value={entryType}
                onChange={(event) => setEntryType(event.target.value)}
                className={SELECT_CLASS}
              >
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium">
              Reason
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Trade-in #482"
              />
            </label>
            <Button disabled={isSaving || !amount || !reason.trim()} onClick={onSubmit}>
              {isSaving ? "Saving…" : mode === "add" ? "Add credit" : "Remove credit"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      ) : null}

      {ledger.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-semibold">Type</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-left font-semibold">Reason</th>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 capitalize">{entry.entryType.replace(/_/g, " ")}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      entry.amountDelta > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive",
                    )}
                  >
                    {entry.amountDelta > 0 ? "+" : ""}
                    {formatMoney(entry.amountDelta, account.currency)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.reason}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No store credit activity yet.</p>
      )}
    </div>
  );
}
