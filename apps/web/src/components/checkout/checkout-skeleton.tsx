export function CheckoutSkeleton() {
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        {/* Step 1 Skeleton */}
        <div className="rounded-lg border p-6">
          <div className="h-6 w-1/2 animate-pulse rounded bg-muted mb-4" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4">
                <div className="h-5 w-2/3 animate-pulse rounded bg-muted mb-2" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>

        {/* Step 2 Skeleton */}
        <div className="rounded-lg border p-6 opacity-50">
          <div className="h-6 w-1/2 animate-pulse rounded bg-muted mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      </div>

      {/* Progress Indicator Skeleton */}
      <div className="rounded-lg border p-4 bg-muted space-y-4">
        <div className="h-5 w-1/2 animate-pulse rounded bg-background" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 w-2/3 animate-pulse rounded bg-background" />
          ))}
        </div>
      </div>
    </div>
  );
}
