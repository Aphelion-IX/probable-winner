import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { cn } from "@/lib/utils";
import { getSet } from "@/features/catalogue/queries/list-sets";
import { listSetCards } from "@/features/catalogue/queries/list-set-cards";
import { SetIcon } from "@/components/commerce/set-icon";
import { CardNameHoverPreview } from "@/features/catalogue/components/card-name-hover-preview";
import { SetCardAddToCartButton } from "@/features/catalogue/components/set-card-add-to-cart-button";
import { SetCardFilterBar } from "@/features/catalogue/components/set-card-filter-bar";
import { COLOR_SWATCH_CLASSES } from "@/features/catalogue/lib/color-swatches";
import type { CardColor } from "@/features/catalogue/queries/list-cards";

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

const finishLabels: Record<string, string> = {
  foil: "Foil",
  etched: "Etched Foil",
};

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export async function generateMetadata({ params }: SetDetailPageProps): Promise<Metadata> {
  const { code } = await params;
  const set = await getSet(code);
  return { title: set ? set.name : "Set not found" };
}

export default async function SetDetailPage({ params, searchParams }: SetDetailPageProps) {
  const { code } = await params;
  const { inStock, colors, finishes, treatments, sort } = await searchParams;
  const inStockOnly = inStock !== "false";

  const set = await getSet(code);
  if (!set) {
    notFound();
  }
  const setCode = set.code;

  const cards = await listSetCards(code, {
    inStockOnly,
    colors: parseList(colors),
    finishes: parseList(finishes),
    borderColors: parseList(treatments),
    sort,
  });

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

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {anyFilterApplied ? (
            <>No cards match these filters.</>
          ) : inStockOnly ? (
            <>
              Nothing in stock right now.{" "}
              <Link href={stockToggleHref(false)} className="text-primary hover:underline">
                Show everything in this set
              </Link>
              .
            </>
          ) : (
            <>No cards found for this set.</>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Colour</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Qty</th>
                <th className="px-4 py-3 text-right font-semibold">$</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr
                  key={`${card.printingId}-${card.finishCode}`}
                  className="border-b hover:bg-muted/50"
                >
                  <td className="px-4 py-3 font-medium">
                    <CardNameHoverPreview
                      href={`/cards/${encodeURIComponent(card.name)}/${card.printingId}`}
                      name={card.name}
                      imageUrl={card.imageUrl}
                    />
                    {finishLabels[card.finishCode] && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {finishLabels[card.finishCode]}
                      </span>
                    )}
                    {card.borderColor === "borderless" && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        Borderless
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {card.colors.length === 0 ? (
                        <span
                          className={`size-4 rounded-full border ${COLOR_SWATCH_CLASSES.C}`}
                          title="Colourless"
                        />
                      ) : (
                        card.colors.map((color) => (
                          <span
                            key={color}
                            className={`size-4 rounded-full border ${COLOR_SWATCH_CLASSES[color as CardColor]}`}
                            title={color}
                          />
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{card.typeLine}</td>
                  <td className="px-4 py-3 text-right">{card.availableQuantity}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {card.price != null ? priceFormatter.format(card.price) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <SetCardAddToCartButton sellableSkuId={card.representativeSkuId} />
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
