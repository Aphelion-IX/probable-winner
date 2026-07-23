"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useQueryParamList } from "@/features/catalogue/lib/use-query-params";
import { CARD_FINISHES, CARD_RARITIES } from "@/features/catalogue/queries/list-cards";

const FINISH_LABELS: Record<string, string> = {
  nonfoil: "Non-foil",
  foil: "Foil",
  etched: "Etched",
};

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function FilterCheckboxRow({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="group flex items-center gap-2 text-sm text-foreground has-disabled:text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      {label}
    </label>
  );
}

export function CardFiltersSidebar({
  availableSets,
}: {
  availableSets: { code: string; name: string }[];
}) {
  const setFilter = useQueryParamList("sets");
  const rarityFilter = useQueryParamList("rarities");
  const finishFilter = useQueryParamList("finishes");

  return (
    <aside className="flex w-full flex-col gap-6 sm:w-56 sm:shrink-0">
      <h2 className="text-sm font-semibold tracking-tight">Filters</h2>

      <FilterGroup title="Set">
        {availableSets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sets in the catalogue yet.</p>
        ) : (
          availableSets.map((set) => (
            <FilterCheckboxRow
              key={set.code}
              label={set.name}
              checked={setFilter.values.includes(set.code)}
              onCheckedChange={() => setFilter.toggle(set.code)}
            />
          ))
        )}
      </FilterGroup>

      <FilterGroup title="Availability">
        <FilterCheckboxRow label="In stock only" checked={false} disabled />
        <p className="text-xs text-muted-foreground">
          Coming soon — inventory isn&apos;t tracked yet (backlog Step 7).
        </p>
      </FilterGroup>

      <FilterGroup title="Treatment">
        {CARD_FINISHES.map((finish) => (
          <FilterCheckboxRow
            key={finish}
            label={FINISH_LABELS[finish] ?? finish}
            checked={finishFilter.values.includes(finish)}
            onCheckedChange={() => finishFilter.toggle(finish)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Rarity">
        {CARD_RARITIES.map((rarity) => (
          <FilterCheckboxRow
            key={rarity}
            label={rarity.charAt(0).toUpperCase() + rarity.slice(1)}
            checked={rarityFilter.values.includes(rarity)}
            onCheckedChange={() => rarityFilter.toggle(rarity)}
          />
        ))}
      </FilterGroup>
    </aside>
  );
}
