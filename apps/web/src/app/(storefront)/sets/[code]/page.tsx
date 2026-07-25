import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { X } from "lucide-react";

import { getSet } from "@/features/catalogue/queries/list-sets";
import { listSetCards } from "@/features/catalogue/queries/list-set-cards";
import { SetIcon } from "@/components/commerce/set-icon";
import { CardNameHoverPreview } from "@/features/catalogue/components/card-name-hover-preview";
import { SetCardAddToCartButton } from "@/features/catalogue/components/set-card-add-to-cart-button";
import { COLOR_SWATCH_CLASSES } from "@/features/catalogue/lib/color-swatches";
import type { CardColor } from "@/features/catalogue/queries/list-cards";

type SetDetailPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ inStock?: string }>;
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
  const { inStock } = await searchParams;
  const inStockOnly = inStock !== "false";

  const set = await getSet(code);
  if (!set) {
    notFound();
  }

  const cards = await listSetCards(code, { inStockOnly });

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

      <div className="flex items-center gap-2">
        {inStockOnly ? (
          <Link
            href={`/sets/${set.code}?inStock=false`}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-muted/70"
          >
            In Stock
            <X className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <Link
            href={`/sets/${set.code}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-xs font-medium text-muted-foreground hover:border-ring/60 hover:text-foreground"
          >
            Show in-stock only
          </Link>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {inStockOnly ? (
            <>
              Nothing in stock right now.{" "}
              <Link
                href={`/sets/${set.code}?inStock=false`}
                className="text-primary hover:underline"
              >
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
