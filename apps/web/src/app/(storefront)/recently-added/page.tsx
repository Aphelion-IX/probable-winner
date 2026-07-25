import { CardTile } from "@/components/commerce/card-tile";
import { listRecentlyAddedCards } from "@/features/catalogue/queries/recently-added-cards";

export const metadata = {
  title: "Recently added",
};

export default async function RecentlyAddedPage() {
  const cards = await listRecentlyAddedCards();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Recently added</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Newly catalogued cards that are currently in stock.
      </p>

      {cards.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">Nothing new yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Check back soon — this feed updates as new stock is catalogued.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((card) => (
            <CardTile
              key={card.printingId}
              href={`/cards/${encodeURIComponent(card.name)}/${card.printingId}`}
              name={card.name}
              setCode={card.setCode}
              rarity={card.rarity}
              condition={card.condition}
              finish={
                card.finish === "foil" ? "Foil" : card.finish === "etched" ? "Etched" : undefined
              }
              price={card.price}
            />
          ))}
        </div>
      )}
    </div>
  );
}
