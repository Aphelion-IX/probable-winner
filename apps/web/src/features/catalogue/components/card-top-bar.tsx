"use client";

import { cn } from "@/lib/utils";
import { useQueryParam, useQueryParamList } from "@/features/catalogue/lib/use-query-params";
import { CARD_COLORS, CARD_TYPES, type CardColor } from "@/features/catalogue/queries/list-cards";

const COLOR_SWATCH_CLASSES: Record<CardColor, string> = {
  W: "bg-amber-50 text-amber-900 border-amber-300",
  U: "bg-sky-500 text-white border-sky-600",
  B: "bg-neutral-800 text-white border-neutral-900",
  R: "bg-red-500 text-white border-red-600",
  G: "bg-green-600 text-white border-green-700",
  C: "bg-muted text-muted-foreground border-border",
};

function ToggleChip({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-all outline-none",
        "hover:border-ring/60 hover:shadow-[0_0_8px_var(--color-ring)]",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:shadow-[0_0_12px_var(--color-ring)]",
        active ? "ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100",
        className,
      )}
    >
      {label}
    </button>
  );
}

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
