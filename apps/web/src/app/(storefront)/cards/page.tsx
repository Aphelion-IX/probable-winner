import { listCards } from "@/features/catalogue/queries/list-cards";
import { listSets } from "@/features/catalogue/queries/list-sets";
import { CardFiltersSidebar } from "@/features/catalogue/components/card-filters-sidebar";
import { CardTopBar } from "@/features/catalogue/components/card-top-bar";
import { CardTile } from "@/components/commerce/card-tile";

function parseList(value: string | undefined): string[] | undefined {
  return value ? value.split(",").filter(Boolean) : undefined;
}

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    sets?: string;
    rarities?: string;
    finishes?: string;
    colors?: string;
    types?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;

  const [availableSets, cards] = await Promise.all([
    listSets(),
    listCards({
      sets: parseList(params.sets),
      rarities: parseList(params.rarities),
      finishes: parseList(params.finishes),
      colors: parseList(params.colors),
      types: parseList(params.types),
      sort: params.sort,
    }),
  ]);

  const anyFilterApplied = Boolean(
    params.sets || params.rarities || params.finishes || params.colors || params.types,
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse every printing in the catalogue.
        </p>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <CardFiltersSidebar
          availableSets={availableSets.map((set) => ({ code: set.code, name: set.name }))}
        />

        <div className="flex flex-1 flex-col gap-4">
          <CardTopBar />

          {cards.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {anyFilterApplied ? (
                <>No cards match these filters.</>
              ) : (
                <>
                  No cards have been imported yet — the catalogue importer (backlog Step 5)
                  hasn&apos;t run against this environment yet. See <code>docs/backlog.md</code>.
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {cards.map((card) => (
                <CardTile
                  key={card.printingId}
                  href={`/cards/${encodeURIComponent(card.name)}/${card.printingId}`}
                  name={card.name}
                  setCode={card.setCode}
                  rarity={card.rarity}
                  imageSrc={card.imageUrl ?? undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
