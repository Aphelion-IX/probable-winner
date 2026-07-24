"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import {
  getPricingReviewQueue,
  approvePrice,
  overridePrice,
  rejectPrice,
  type PricingReviewItem,
} from "@/features/staff/actions/manage-pricing-review";
import { Button } from "@/components/ui/button";

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(amount);
}

export default function StaffPricingPage() {
  const [items, setItems] = useState<PricingReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [overrideDraftId, setOverrideDraftId] = useState<string | null>(null);
  const [overrideAmount, setOverrideAmount] = useState("");

  useEffect(() => {
    async function loadInitialQueue() {
      try {
        const data = await getPricingReviewQueue();
        setItems(data);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load pricing review queue");
      } finally {
        setLoading(false);
      }
    }

    loadInitialQueue();
  }, []);

  async function withPending(id: string, action: () => Promise<void>) {
    setPendingId(id);
    setActionError(null);
    try {
      await action();
      const data = await getPricingReviewQueue();
      setItems(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
      Sentry.captureException(err);
    } finally {
      setPendingId(null);
      setOverrideDraftId(null);
      setOverrideAmount("");
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pricing review queue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Suggested prices awaiting approval, override, or rejection. Requires the pricing.approve
          or pricing.override permission.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {loadError}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {actionError}
        </div>
      ) : null}

      {!loadError && items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No suggested prices awaiting review.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.card_name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.set_code} #{item.collector_number} • {item.rule_name}
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="text-muted-foreground">
                      {formatAmount(item.base_amount, item.base_currency)} base →
                    </span>{" "}
                    <span className="font-semibold">
                      {formatAmount(item.final_amount, item.currency)}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    disabled={pendingId === item.id}
                    onClick={() => withPending(item.id, () => approvePrice(item.id))}
                    className="text-xs"
                  >
                    Approve
                  </Button>
                  <Button
                    disabled={pendingId === item.id}
                    variant="outline"
                    onClick={() => setOverrideDraftId(overrideDraftId === item.id ? null : item.id)}
                    className="text-xs"
                  >
                    Override
                  </Button>
                  <Button
                    disabled={pendingId === item.id}
                    variant="outline"
                    onClick={() => withPending(item.id, () => rejectPrice(item.id))}
                    className="text-xs"
                  >
                    Reject
                  </Button>
                </div>
              </div>

              {overrideDraftId === item.id ? (
                <div className="mt-3 flex items-center gap-2 rounded bg-muted/30 p-3">
                  <label htmlFor={`override-${item.id}`} className="text-xs font-medium">
                    Override amount ({item.currency})
                  </label>
                  <input
                    id={`override-${item.id}`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrideAmount}
                    onChange={(e) => setOverrideAmount(e.target.value)}
                    className="w-28 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
                  />
                  <Button
                    disabled={pendingId === item.id || overrideAmount.trim() === ""}
                    onClick={() =>
                      withPending(item.id, () => overridePrice(item.id, Number(overrideAmount)))
                    }
                    className="text-xs"
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOverrideDraftId(null);
                      setOverrideAmount("");
                    }}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
