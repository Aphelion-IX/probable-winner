import { fetchScopedNodes, type ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import { listRecentReceipts, type ReceiptRow } from "@/features/staff/actions/manage-receiving";
import { ReceivingWorkbench } from "@/features/staff/components/receiving-workbench";
import { PageHeader } from "@/components/staff/page-header";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffReceivingPage() {
  let nodes: ScopedNode[] = [];
  let receipts: ReceiptRow[] = [];
  let error: string | null = null;

  try {
    [nodes, receipts] = await Promise.all([fetchScopedNodes(), listRecentReceipts()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load receiving";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving"
        description="Book incoming stock into a store, one line or a whole shipment manifest at once. Each receipt appends to the inventory ledger and makes the cards sellable immediately."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <ReceivingWorkbench nodes={nodes} initialReceipts={receipts} />
      )}
    </div>
  );
}
