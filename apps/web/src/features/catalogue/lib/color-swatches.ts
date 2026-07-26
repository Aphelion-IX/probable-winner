import type { CardColor } from "@/features/catalogue/lib/card-facets";

// WUBRG colour-identity swatches, shared between the filter chips
// (card-top-bar.tsx) and anywhere else a card's colour needs a small visual
// pip (e.g. the set-detail table) -- one mapping, not a copy per component.
export const COLOR_SWATCH_CLASSES: Record<CardColor, string> = {
  W: "bg-amber-50 text-amber-900 border-amber-300",
  U: "bg-sky-500 text-white border-sky-600",
  B: "bg-neutral-800 text-white border-neutral-900",
  R: "bg-red-500 text-white border-red-600",
  G: "bg-green-600 text-white border-green-700",
  C: "bg-muted text-muted-foreground border-border",
};
