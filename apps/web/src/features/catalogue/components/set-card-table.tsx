import Link from "next/link";

import { listSetCards } from "@/features/catalogue/queries/list-set-cards";
import { CardNameHoverPreview } from "@/features/catalogue/components/card-name-hover-preview";
import { SetCardAddToCartButton } from "@/features/catalogue/components/set-card-add-to-cart-button";
import { COLOR_SWATCH_CLASSES } from "@/features/catalogue/lib/color-swatches";
import type { CardColor } from "@/features/catalogue/queries/list-cards";

const finishLabels: Record<string, string> = {
  foil: "Foil",
  etched: "Etched Foil",
};

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

type SetCardTableProps = {
  code: string;
  inStockOnly: boolean;
  colors?: string[];
  finishes?: string[];
  borderColors?: string[];
  sort?: string;
  anyFilterApplied: boolean;
  showEverythingHref: string;
};

// This is the slow part of /sets/[code] (listSetCards -- see that module's
// own comments on why: even collapsed into one database round trip, it's
// still a query over a whole set's worth of printings, 108-306ms for the
// largest real sets). Kept as its own async component, rendered inside a
// <Suspense> boundary by the page, so the header/stock-toggle/filter bar
// (which don't depend on this data at all) stream to the browser immediately
// instead of waiting on it -- see
// node_modules/next/dist/docs/01-app/02-guides/streaming.md's "push dynamic
// access down" guidance.
export async function SetCardTable({
  code,
  inStockOnly,
  colors,
  finishes,
  borderColors,
  sort,
  anyFilterApplied,
  showEverythingHref,
}: SetCardTableProps) {
  const cards = await listSetCards(code, { inStockOnly, colors, finishes, borderColors, sort });

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {anyFilterApplied ? (
          <>No cards match these filters.</>
        ) : inStockOnly ? (
          <>
            Nothing in stock right now.{" "}
            <Link href={showEverythingHref} className="text-primary hover:underline">
              Show everything in this set
            </Link>
            .
          </>
        ) : (
          <>No cards found for this set.</>
        )}
      </div>
    );
  }

  return (
    <div className="glass-panel overflow-x-auto rounded-lg">
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
  );
}

// Matches the real table's header + a handful of row heights so the
// Suspense swap doesn't reflow the page (blueprint's CLS budget) -- see the
// streaming guide's "design skeleton fallbacks that match the dimensions of
// the content they represent".
export function SetCardTableSkeleton() {
  return (
    <div className="glass-panel overflow-x-auto rounded-lg">
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
          {Array.from({ length: 8 }, (_, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-3">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              </td>
              <td className="px-4 py-3">
                <div className="size-4 animate-pulse rounded-full bg-muted" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="ml-auto h-4 w-8 animate-pulse rounded bg-muted" />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="ml-auto h-4 w-12 animate-pulse rounded bg-muted" />
              </td>
              <td className="px-4 py-3">
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
