"use client";

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useQueryParam, useQueryParamList } from "@/features/catalogue/lib/use-query-params";
import {
  CARD_COLORS,
  CARD_FINISHES,
  CARD_BORDER_COLORS,
} from "@/features/catalogue/lib/card-facets";
import { COLOR_SWATCH_CLASSES } from "@/features/catalogue/lib/color-swatches";
import { ToggleChip } from "@/features/catalogue/components/toggle-chip";

const FINISH_LABELS: Record<string, string> = {
  nonfoil: "Non-foil",
  foil: "Foil",
  etched: "Etched",
};

const BORDER_COLOR_LABELS: Record<string, string> = {
  black: "Standard",
  white: "White Border",
  borderless: "Borderless / Full Art",
  gold: "Gold Border",
  silver: "Silver Border",
  yellow: "Yellow Border",
};

// The chips themselves live inside a Sheet rather than sitting inline --
// three always-visible rows of colour/foil/treatment chips dominated the
// page above the table. A single "Filters" trigger (with an active-count
// badge) keeps the page compact while the full chip set is still one tap
// away.
export function SetCardFilterBar() {
  const colorFilter = useQueryParamList("colors");
  const finishFilter = useQueryParamList("finishes");
  const treatmentFilter = useQueryParamList("treatments");
  const sort = useQueryParam("sort");

  const activeCount =
    colorFilter.values.length + finishFilter.values.length + treatmentFilter.values.length;

  return (
    <div className="flex items-center justify-between gap-2 border-b pb-4">
      <Sheet>
        <SheetTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
          <SlidersHorizontal className="size-3.5" />
          Filters
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-0.5">
              {activeCount}
            </Badge>
          )}
        </SheetTrigger>
        <SheetContent side="right" className="w-80 overflow-y-auto">
          <SheetHeader className="border-b">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4 pb-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Colour</span>
              <div className="flex flex-wrap gap-1.5">
                {CARD_COLORS.map((color) => (
                  <ToggleChip
                    key={color}
                    label={color}
                    active={colorFilter.values.includes(color)}
                    onClick={() => colorFilter.toggle(color)}
                    className={COLOR_SWATCH_CLASSES[color]}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Foil</span>
              <div className="flex flex-wrap gap-1.5">
                {CARD_FINISHES.map((finish) => (
                  <ToggleChip
                    key={finish}
                    label={FINISH_LABELS[finish] ?? finish}
                    active={finishFilter.values.includes(finish)}
                    onClick={() => finishFilter.toggle(finish)}
                    className="border-border bg-background text-foreground"
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Treatment</span>
              <div className="flex flex-wrap gap-1.5">
                {CARD_BORDER_COLORS.map((borderColor) => (
                  <ToggleChip
                    key={borderColor}
                    label={BORDER_COLOR_LABELS[borderColor] ?? borderColor}
                    active={treatmentFilter.values.includes(borderColor)}
                    onClick={() => treatmentFilter.toggle(borderColor)}
                    className="border-border bg-background text-foreground"
                  />
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex items-center gap-2">
        <label htmlFor="set-card-sort" className="text-xs font-medium text-muted-foreground">
          Sort
        </label>
        <select
          id="set-card-sort"
          value={sort.value || "name-asc"}
          onChange={(event) => sort.set(event.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none transition-all hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:shadow-[0_0_12px_var(--color-ring)] dark:bg-input/30"
        >
          <option value="name-asc">Name: A to Z</option>
          <option value="price-desc">Price: High to low</option>
          <option value="price-asc">Price: Low to high</option>
        </select>
      </div>
    </div>
  );
}
