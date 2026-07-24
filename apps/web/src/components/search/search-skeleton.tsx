export function SearchSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-lg border bg-card">
            <div className="aspect-square w-full bg-muted animate-pulse" />
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="mt-auto h-5 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
