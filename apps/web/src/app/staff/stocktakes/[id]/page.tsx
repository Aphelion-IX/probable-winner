import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getStocktake } from "@/features/staff/actions/manage-stocktakes";
import { StocktakeDetailActions } from "@/features/staff/components/stocktake-detail-actions";
import { PageHeader } from "@/components/staff/page-header";
import { StatusBadge } from "@/components/staff/status-badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

interface StocktakeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffStocktakeDetailPage({ params }: StocktakeDetailPageProps) {
  const { id } = await params;
  const stocktake = await getStocktake(id);

  if (!stocktake) {
    notFound();
  }

  const totalExpected = stocktake.lines.reduce((sum, line) => sum + line.expectedQuantity, 0);
  const totalCounted = stocktake.lines.reduce((sum, line) => sum + (line.countedQuantity ?? 0), 0);

  return (
    <div className="space-y-6">
      <Link
        href="/staff/stocktakes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All stocktakes
      </Link>

      <PageHeader
        title={stocktake.nodeName}
        description={stocktake.notes ?? undefined}
        actions={
          <StatusBadge status={stocktake.status} label={stocktake.status.replace(/_/g, " ")} />
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Lines</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stocktake.lines.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Expected total</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totalExpected}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Counted total</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {totalCounted}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              ({stocktake.countedCount}/{stocktake.lineCount} lines)
            </span>
          </p>
        </div>
      </div>

      <StocktakeDetailActions stocktake={stocktake} />
    </div>
  );
}
