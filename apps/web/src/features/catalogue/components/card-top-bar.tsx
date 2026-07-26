"use client";

import { useQueryParam, useQueryParamList } from "@/features/catalogue/lib/use-query-params";
import { CARD_COLORS, CARD_TYPES } from "@/features/catalogue/lib/card-facets";
import { COLOR_SWATCH_CLASSES } from "@/features/catalogue/lib/color-swatches";
import { ToggleChip } from "@/features/catalogue/components/toggle-chip";

export function CardTopBar() {
  const colorFilter = useQueryParamList("colors");
  const typeFilter = useQueryParamList("types");
  const sort = useQueryParam("sort");

  return (
    <div className="flex flex-col gap-4 border-b pb-4">
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
          <span className="mr-1 text-xs font-medium text-muted-foreground">Type</span>
          {CARD_TYPES.map((type) => (
            <ToggleChip
              key={type}
              label={type}
              active={typeFilter.values.includes(type)}
              onClick={() => typeFilter.toggle(type)}
              className="border-border bg-background text-foreground"
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="card-sort" className="text-xs font-medium text-muted-foreground">
          Sort
        </label>
        <select
          id="card-sort"
          value={sort.value || "name-asc"}
          onChange={(event) => sort.set(event.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none transition-all hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:shadow-[0_0_12px_var(--color-ring)] dark:bg-input/30"
        >
          <option value="name-asc">Name: A to Z</option>
          <option value="name-desc">Name: Z to A</option>
          <option value="newest">Release date: newest</option>
          <option value="oldest">Release date: oldest</option>
          <option value="rarity">Rarity</option>
          <option value="price-desc" disabled>
            Price: High to low (coming soon)
          </option>
          <option value="price-asc" disabled>
            Price: Low to high (coming soon)
          </option>
        </select>
      </div>
    </div>
  );
}
