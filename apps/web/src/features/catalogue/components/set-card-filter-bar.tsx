"use client";

import { useQueryParam, useQueryParamList } from "@/features/catalogue/lib/use-query-params";
import { CARD_COLORS, CARD_FINISHES } from "@/features/catalogue/queries/list-cards";
import { CARD_BORDER_COLORS } from "@/features/catalogue/queries/list-set-cards";
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

export function SetCardFilterBar() {
  const colorFilter = useQueryParamList("colors");
  const finishFilter = useQueryParamList("finishes");
  const treatmentFilter = useQueryParamList("treatments");
  const sort = useQueryParam("sort");

  return (
    <div className="flex flex-col gap-3 border-b pb-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Colour</span>
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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Foil</span>
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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Treatment</span>
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
