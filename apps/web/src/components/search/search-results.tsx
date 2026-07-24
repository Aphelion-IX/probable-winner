import { CardTile } from "@/components/commerce/card-tile";
import { Pagination } from "@/components/search/pagination";

interface SearchResultsProps {
  searchParams: Record<string, string | string[] | undefined>;
}

interface SearchHit {
  id: string;
  name: string;
  set: string;
  rarity: string;
  artist: string;
  condition: string;
  finish: string;
  price: number;
}

interface SearchResponse {
  hits: SearchHit[];
  page: number;
  pageSize: number;
  totalHits: number;
  totalPages: number;
  processingTimeMs: number;
}

export async function SearchResults({ searchParams }: SearchResultsProps) {
  const query = new URLSearchParams();

  // Map search params to API parameters
  if (searchParams.q) {
    query.append("q", String(searchParams.q));
  }
  if (searchParams.set) {
    query.append("set", String(searchParams.set));
  }
  if (searchParams.artist) {
    query.append("artist", String(searchParams.artist));
  }
  if (searchParams.rarity) {
    query.append("rarity", String(searchParams.rarity));
  }
  if (searchParams.finish) {
    query.append("finish", String(searchParams.finish));
  }
  if (searchParams.condition) {
    query.append("condition", String(searchParams.condition));
  }
  if (searchParams.colour) {
    const colours = Array.isArray(searchParams.colour)
      ? searchParams.colour
      : [searchParams.colour];
    colours.forEach((c) => query.append("colour", c));
  }
  if (searchParams.minPrice) {
    query.append("minPrice", String(searchParams.minPrice));
  }
  if (searchParams.maxPrice) {
    query.append("maxPrice", String(searchParams.maxPrice));
  }
  if (searchParams.inStock === "true") {
    query.append("inStock", "true");
  }
  if (searchParams.storeId) {
    query.append("storeId", String(searchParams.storeId));
  }
  const page = searchParams.page ? Number(searchParams.page) : 1;
  query.append("page", String(page));
  if (searchParams.limit) {
    query.append("limit", String(searchParams.limit));
  }
  if (searchParams.sort) {
    query.append("sort", String(searchParams.sort));
  }

  let data: SearchResponse | null = null;
  let hasError = false;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/search?${query}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      hasError = true;
    } else {
      data = await response.json();
    }
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
            href={`/cards/${encodeURIComponent(hit.name)}/${hit.id}`}
            name={hit.name}
            setCode={hit.set}
            rarity={hit.rarity}
            condition={hit.condition}
            finish={hit.finish === "foil" ? "Foil" : hit.finish === "etched" ? "Etched" : undefined}
            price={hit.price}
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
