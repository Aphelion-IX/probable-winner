import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { cn } from "@/lib/utils";
import { getSet } from "@/features/catalogue/queries/list-sets";
import { SetIcon } from "@/components/commerce/set-icon";
import { SetCardFilterBar } from "@/features/catalogue/components/set-card-filter-bar";
import { SetCardTable, SetCardTableSkeleton } from "@/features/catalogue/components/set-card-table";

function parseList(value: string | undefined): string[] | undefined {
  return value ? value.split(",").filter(Boolean) : undefined;
}

type SetDetailPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    inStock?: string;
    colors?: string;
    finishes?: string;
    treatments?: string;
    sort?: string;
  }>;
};

export async function generateMetadata({ params }: SetDetailPageProps): Promise<Metadata> {
  const { code } = await params;
  const set = await getSet(code);
  return { title: set ? set.name : "Set not found" };
}

export default async function SetDetailPage({ params, searchParams }: SetDetailPageProps) {
  const { code } = await params;
  const { inStock, colors, finishes, treatments, sort } = await searchParams;
  const inStockOnly = inStock !== "false";

  // Only the set's own row (name/icon) is needed for the header and the
  // notFound() check, and it's fast -- this stays outside Suspense so the
  // real 404 status code can still be sent (see the streaming guide: a
  // notFound() after streaming starts can only fall back to a client-side
  // redirect, not a real HTTP 404). The card table's query is the expensive
  // part of this page (listSetCards -- still a whole-set query even
  // collapsed into one round trip) and streams in separately below via
  // <SetCardTable>, so this header/toggle/filter bar don't wait on it.
  const set = await getSet(code);
  if (!set) {
    notFound();
  }
  const setCode = set.code;

  // Toggling the stock filter should keep any colour/foil/treatment/sort
  // filters already applied, not reset them.
  const otherParams = new URLSearchParams();
  if (colors) otherParams.set("colors", colors);
  if (finishes) otherParams.set("finishes", finishes);
  if (treatments) otherParams.set("treatments", treatments);
  if (sort) otherParams.set("sort", sort);
  const otherParamsString = otherParams.toString();

  function stockToggleHref(nextInStock: boolean) {
    const params = new URLSearchParams(otherParamsString);
    if (!nextInStock) params.set("inStock", "false");
    const query = params.toString();
    return query ? `/sets/${setCode}?${query}` : `/sets/${setCode}`;
  }

  const anyFilterApplied = Boolean(colors || finishes || treatments);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/sets" className="hover:text-foreground hover:underline">
          Sets
        </Link>
        <span aria-hidden>/</span>
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <SetIcon url={set.iconUrl} alt="" />
          {set.name}
        </span>
      </nav>

      <div
        role="group"
        aria-label="Stock filter"
        className="inline-flex w-fit rounded-full border p-0.5 text-xs font-medium"
      >
        <Link
          href={stockToggleHref(true)}
          aria-current={inStockOnly ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1 transition-colors",
            inStockOnly
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          In Stock
        </Link>
        <Link
          href={stockToggleHref(false)}
          aria-current={!inStockOnly ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1 transition-colors",
            !inStockOnly
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </Link>
      </div>

      <SetCardFilterBar />

      <Suspense fallback={<SetCardTableSkeleton />}>
        <SetCardTable
          code={code}
          inStockOnly={inStockOnly}
          colors={parseList(colors)}
          finishes={parseList(finishes)}
          borderColors={parseList(treatments)}
          sort={sort}
          anyFilterApplied={anyFilterApplied}
          showEverythingHref={stockToggleHref(false)}
        />
      </Suspense>
    </div>
  );
}
