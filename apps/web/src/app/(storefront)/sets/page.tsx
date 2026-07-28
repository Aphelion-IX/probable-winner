import Link from "next/link";

import { listSets } from "@/features/catalogue/queries/list-sets";
import { SetSearchInput } from "@/features/catalogue/components/set-search-input";
import { SetIcon } from "@/components/commerce/set-icon";

function formatDate(releasedAt: string | null): string {
  if (!releasedAt) return "—";
  return releasedAt.slice(0, 10);
}

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const sets = await listSets({ search: q });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse every Magic: The Gathering set in the catalogue.
        </p>
      </div>

      <SetSearchInput />

      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {q ? (
            <>No sets match &quot;{q}&quot;.</>
          ) : (
            <>
              No sets have been imported yet — the catalogue importer (backlog Step 5) hasn&apos;t
              run against this environment yet. See <code>docs/backlog.md</code>.
            </>
          )}
        </div>
      ) : (
        <div className="glass-panel overflow-x-auto rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-right font-semibold">Cards</th>
                <th className="px-4 py-3 text-right font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((set) => (
                <tr key={set.code} className="border-b hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/sets/${set.code}`}
                      className="flex items-center gap-1.5 font-medium hover:underline"
                    >
                      <SetIcon url={set.iconUrl} alt="" />
                      {set.name}
                      <span className="font-mono text-xs text-muted-foreground uppercase">
                        {set.code}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{set.cardCount}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {formatDate(set.releasedAt)}
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
