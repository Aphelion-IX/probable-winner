import { listSets } from "@/features/catalogue/queries/list-sets";

export const revalidate = 300;

const dateFormatter = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" });

function formatSetMeta(setType: string | null, releasedAt: string | null, cardCount: number) {
  const parts: string[] = [];
  if (setType) parts.push(setType.charAt(0).toUpperCase() + setType.slice(1));
  if (releasedAt) parts.push(dateFormatter.format(new Date(releasedAt)));
  parts.push(`${cardCount} cards`);
  return parts.join(" · ");
}

export default async function SetsPage() {
  const sets = await listSets();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse every Magic: The Gathering set in the catalogue.
        </p>
      </div>

      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sets have been imported yet — the catalogue importer (backlog Step 5) hasn&apos;t run
          against this environment yet. See <code>docs/backlog.md</code>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sets.map((set) => (
            <div key={set.code} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-medium">{set.name}</h2>
                <span className="font-mono text-xs text-muted-foreground uppercase">
                  {set.code}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatSetMeta(set.setType, set.releasedAt, set.cardCount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
