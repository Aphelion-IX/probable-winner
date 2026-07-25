import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { fetchScopedNodes, type ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import { listTransferOrders, type TransferSummary } from "@/features/staff/actions/manage-transfers";
import { TransferCreateForm } from "@/features/staff/components/transfer-create-form";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-AU", { dateStyle: "medium" });
}

export default async function StaffTransfersPage() {
  let nodes: ScopedNode[] = [];
  let transfers: TransferSummary[] = [];
  let error: string | null = null;

  try {
    [nodes, transfers] = await Promise.all([fetchScopedNodes(), listTransferOrders()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load transfers";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transfers"
        description="Move stock between your stores and warehouses. Stock leaves the source on dispatch and lands at the destination on receipt."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <TransferCreateForm nodes={nodes} />

          {transfers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No transfers involve your stores yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-semibold">Route</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Lines</th>
                    <th className="px-4 py-3 text-left font-semibold">Notes</th>
                    <th className="px-4 py-3 text-left font-semibold">Created</th>
                    <th className="px-4 py-3 text-right font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((transfer) => (
                    <tr key={transfer.id} className="border-b last:border-b-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-medium">
                          {transfer.sourceNodeName}
                          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                          {transfer.destinationNodeName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={transfer.status}
                          label={transfer.status.replace(/_/g, " ")}
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{transfer.lineCount}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {transfer.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(transfer.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/staff/transfers/${transfer.id}`}
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
