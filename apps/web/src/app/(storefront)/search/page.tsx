import { Suspense } from "react";
import { SearchResults } from "@/components/search/search-results";
import { SearchFilters } from "@/components/search/search-filters";
import { SearchSkeleton } from "@/components/search/search-skeleton";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-4 lg:gap-8 lg:py-12">
      <aside className="md:col-span-1">
        <SearchFilters />
      </aside>

      <main className="md:col-span-3">
        <Suspense fallback={<SearchSkeleton />}>
          <SearchResults searchParams={params} />
        </Suspense>
      </main>
    </div>
  );
}
