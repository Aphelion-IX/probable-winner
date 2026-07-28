import Link from "next/link";

import { fetchScopedNodes, type ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import { listStocktakes, type StocktakeSummary } from "@/features/staff/actions/manage-stocktakes";
import { StocktakeCreateForm } from "@/features/staff/components/stocktake-create-form";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-AU", { dateStyle: "medium" });
}

export default async function StaffStocktakesPage() {
  let nodes: ScopedNode[] = [];
  let stocktakes: StocktakeSummary[] = [];
  let error: string | null = null;

  try {
    [nodes, stocktakes] = await Promise.all([fetchScopedNodes(), listStocktakes()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load stocktakes";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stocktakes"
        description="Count what's actually on the shelf and reconcile any difference against the inventory ledger."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <StocktakeCreateForm nodes={nodes} />

          {stocktakes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No stocktakes yet for your stores.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-semibold">Store</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Counted</th>
                    <th className="px-4 py-3 text-left font-semibold">Notes</th>
                    <th className="px-4 py-3 text-left font-semibold">Created</th>
                    <th className="px-4 py-3 text-right font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {stocktakes.map((stocktake) => (
                    <tr
                      key={stocktake.id}
                      className="border-b last:border-b-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">{stocktake.nodeName}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={stocktake.status}
                          label={stocktake.status.replace(/_/g, " ")}
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {stocktake.countedCount} / {stocktake.lineCount}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {stocktake.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(stocktake.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/staff/stocktakes/${stocktake.id}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
