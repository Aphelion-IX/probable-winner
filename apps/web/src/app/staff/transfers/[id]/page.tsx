import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { getTransferOrder } from "@/features/staff/actions/manage-transfers";
import { TransferDetailActions } from "@/features/staff/components/transfer-detail-actions";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

interface TransferDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTransferDetailPage({ params }: TransferDetailPageProps) {
  const { id } = await params;
  const transfer = await getTransferOrder(id);

  if (!transfer) {
    notFound();
  }

  const totalRequested = transfer.lines.reduce((sum, line) => sum + line.quantityRequested, 0);
  const totalReceived = transfer.lines.reduce((sum, line) => sum + line.quantityGood, 0);

  return (
    <div className="space-y-6">
      <Link
        href="/staff/transfers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All transfers
      </Link>

      <PageHeader
        title={`${transfer.sourceNodeName} → ${transfer.destinationNodeName}`}
        description={transfer.notes ?? undefined}
        actions={
          <StatusBadge status={transfer.status} label={transfer.status.replace(/_/g, " ")} />
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Lines</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{transfer.lines.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Cards requested</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totalRequested}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Received good</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totalReceived}</p>
        </div>
      </div>

      <TransferDetailActions transfer={transfer} />

      {transfer.lines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          This transfer has no lines.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold">Card</th>
                <th className="px-4 py-3 text-right font-semibold">Requested</th>
                <th className="px-4 py-3 text-right font-semibold">Good</th>
                <th className="px-4 py-3 text-right font-semibold">Damaged</th>
                <th className="px-4 py-3 text-right font-semibold">Missing</th>
                <th className="px-4 py-3 text-right font-semibold">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((line) => (
                <tr key={line.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{line.cardName}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {line.setCode.toUpperCase()} #{line.collectorNumber} · {line.finish} ·{" "}
                      {line.condition}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{line.quantityRequested}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{line.quantityGood}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {line.quantityDamaged}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {line.quantityMissing}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {line.quantityOutstanding}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Stock leaves {transfer.sourceNodeName}
        <ArrowRight className="size-3" aria-hidden />
        arrives at {transfer.destinationNodeName}
      </p>
    </div>
  );
}
