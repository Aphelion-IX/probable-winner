import Link from "next/link";
import { Bookmark, Trash2 } from "lucide-react";

import { getSavedList, type SavedListItem } from "@/features/customer/actions/manage-saved-list";

// Requires an authenticated user's session at request time — cannot be
// statically prerendered, same reasoning as (account)/alerts/page.tsx.
export const dynamic = "force-dynamic";

const finishLabels: Record<string, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export default async function SavedListsPage() {
  let items: SavedListItem[] = [];
  let error: string | null = null;

  try {
    items = await getSavedList();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load your saved list";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Saved lists</h1>
        <p className="mt-2 text-sm text-muted-foreground">Cards you&apos;ve saved for later.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Bookmark className="mx-auto h-8 w-8 opacity-50" />
          <p className="mt-2">Nothing saved yet.</p>
          <Link href="/cards" className="mt-4 inline-block text-blue-600 hover:underline">
            Browse cards
          </Link>
        </div>
      ) : (
        <div className="glass-panel overflow-x-auto rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left font-semibold">Card</th>
                <th className="px-6 py-3 text-left font-semibold">Set</th>
                <th className="px-6 py-3 text-left font-semibold">Finish</th>
                <th className="px-6 py-3 text-left font-semibold">Condition</th>
                <th className="px-6 py-3 text-right font-semibold">Price</th>
                <th className="px-6 py-3 text-left font-semibold">Availability</th>
                <th className="px-6 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.sellableSkuId} className="border-b hover:bg-muted/50">
                  <td className="px-6 py-3 font-medium">
                    <Link
                      href={`/cards/${encodeURIComponent(item.cardName)}/${item.printingId}`}
                      className="hover:underline"
                    >
                      {item.cardName}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-xs uppercase text-muted-foreground">
                    {item.setCode}
                  </td>
                  <td className="px-6 py-3 text-xs">
                    {finishLabels[item.finishCode] ?? item.finishCode}
                  </td>
                  <td className="px-6 py-3 text-xs uppercase">{item.conditionCode}</td>
                  <td className="px-6 py-3 text-right font-semibold">
                    {item.price != null ? priceFormatter.format(item.price) : "Unavailable"}
                  </td>
                  <td className="px-6 py-3 text-xs text-muted-foreground">
                    {item.availableQuantity > 0
                      ? `${item.availableQuantity} in stock`
                      : "Out of stock"}
                  </td>
                  <td className="px-6 py-3">
                    <form
                      action={async () => {
                        "use server";
                        const { removeFromSavedList } =
                          await import("@/features/customer/actions/manage-saved-list");
                        await removeFromSavedList(item.sellableSkuId);
                      }}
                      className="inline"
                    >
                      <button
                        type="submit"
                        className="text-red-600 hover:text-red-800"
                        title="Remove from saved list"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
