import { CardTile } from "@/components/commerce/card-tile";
import { Pagination } from "@/components/search/pagination";
import { type SearchQueryParams } from "@/features/catalogue/lib/build-search-query";
import { searchCards, type SearchCardsResult } from "@/features/catalogue/queries/search-cards";

interface SearchResultsProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export async function SearchResults({ searchParams }: SearchResultsProps) {
  const page = searchParams.page ? Number(searchParams.page) : 1;

  const params: SearchQueryParams = {
    q: searchParams.q ? String(searchParams.q) : undefined,
    set: searchParams.set ? String(searchParams.set) : undefined,
    artist: searchParams.artist ? String(searchParams.artist) : undefined,
    rarity: searchParams.rarity ? String(searchParams.rarity) : undefined,
    finish: searchParams.finish ? String(searchParams.finish) : undefined,
    condition: searchParams.condition ? String(searchParams.condition) : undefined,
    colour: searchParams.colour
      ? Array.isArray(searchParams.colour)
        ? searchParams.colour
        : [searchParams.colour]
      : undefined,
    minPrice: searchParams.minPrice ? Number(searchParams.minPrice) : undefined,
    maxPrice: searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined,
    inStock: searchParams.inStock === "true",
    storeId: searchParams.storeId ? String(searchParams.storeId) : undefined,
    page,
    limit: searchParams.limit ? Number(searchParams.limit) : undefined,
    sort: searchParams.sort as SearchQueryParams["sort"] | undefined,
  };

  let data: SearchCardsResult | null = null;
  let hasError = false;

  try {
    data = await searchCards(params);
  } catch {
    hasError = true;
  }

  if (hasError) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/5 p-6">
        <h2 className="font-semibold text-destructive">Search error</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Unable to fetch search results. Please try again later.
        </p>
      </div>
    );
  }

  if (!data || data.hits.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">No results found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try adjusting your filters or search query to find what you&apos;re looking for.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {(page - 1) * data.pageSize + 1} to{" "}
          {Math.min(page * data.pageSize, data.totalHits)} of {data.totalHits} results
        </p>
        <p className="text-xs text-muted-foreground">Found in {data.processingTimeMs}ms</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.hits.map((hit) => (
          <CardTile
            key={hit.id}
            href={`/cards/${encodeURIComponent(hit.name)}/${hit.printingId}`}
            name={hit.name}
            setCode={hit.set}
            rarity={hit.rarity}
            condition={hit.condition}
            finish={hit.finish === "foil" ? "Foil" : hit.finish === "etched" ? "Etched" : undefined}
            price={hit.price}
            imageSrc={hit.imageUrl ?? undefined}
          />
        ))}
      </div>

      {data.totalPages > 1 && (
        <Pagination
          currentPage={data.page}
          totalPages={data.totalPages}
          baseUrl="/search"
          searchParams={searchParams}
        />
      )}
    </div>
  );
}
