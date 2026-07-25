import { fetchScopedNodes, type ScopedNode } from "@/features/staff/actions/fetch-scoped-nodes";
import {
  searchInventory,
  listQuarantinedStock,
  type InventoryRow,
  type QuarantineRow,
} from "@/features/staff/actions/manage-inventory";
import { InventoryWorkbench } from "@/features/staff/components/inventory-workbench";
import { PageHeader } from "@/components/staff/page-header";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffInventoryPage() {
  let nodes: ScopedNode[] = [];
  let initialRows: InventoryRow[] = [];
  let quarantined: QuarantineRow[] = [];
  let error: string | null = null;

  try {
    // Independent queries — no reason to serialise the first paint behind
    // three sequential round trips.
    [nodes, initialRows, quarantined] = await Promise.all([
      fetchScopedNodes(),
      searchInventory({}),
      listQuarantinedStock(),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load inventory";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Search stock across your stores, correct counts, and manage quarantined items. Every correction is written to the movement ledger."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <InventoryWorkbench
          nodes={nodes}
          initialRows={initialRows}
          initialQuarantined={quarantined}
        />
      )}
    </div>
  );
}
