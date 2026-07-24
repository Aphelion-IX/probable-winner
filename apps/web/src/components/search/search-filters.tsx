"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const RARITIES = [
  { id: "common", label: "Common" },
  { id: "uncommon", label: "Uncommon" },
  { id: "rare", label: "Rare" },
  { id: "mythic", label: "Mythic" },
  { id: "special", label: "Special" },
];

const CONDITIONS = [
  { id: "nm", label: "Near Mint" },
  { id: "lp", label: "Light Play" },
  { id: "mp", label: "Moderate Play" },
  { id: "hp", label: "Heavy Play" },
];

const FINISHES = [
  { id: "nonfoil", label: "Nonfoil" },
  { id: "foil", label: "Foil" },
  { id: "etched", label: "Etched" },
];

const COLOURS = [
  { id: "W", label: "White" },
  { id: "U", label: "Blue" },
  { id: "B", label: "Black" },
  { id: "R", label: "Red" },
  { id: "G", label: "Green" },
];

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = (name: string, value: string, checked: boolean) => {
    const params = new URLSearchParams(searchParams);

    if (checked) {
      if (name === "colour") {
        // Handle multi-select for colours
        const existing = params.getAll("colour") || [];
        if (!existing.includes(value)) {
          params.append("colour", value);
        }
      } else {
        params.set(name, value);
      }
    } else {
      if (name === "colour") {
        const existing = params.getAll("colour") || [];
        params.delete("colour");
        existing.filter((c) => c !== value).forEach((c) => params.append("colour", c));
      } else {
        params.delete(name);
      }
    }

    // Reset to page 1 when filters change
    params.set("page", "1");
    router.push(`/search?${params.toString()}`, { scroll: false });
  };

  const isChecked = (name: string, value: string): boolean => {
    if (name === "colour") {
      return searchParams.getAll("colour").includes(value);
    }
    return searchParams.get(name) === value;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-4 text-sm font-semibold">Price Range</h3>
        <div className="space-y-3">
          <div>
            <Label htmlFor="minPrice" className="text-xs text-muted-foreground">
              Min price
            </Label>
            <Input
              id="minPrice"
              type="number"
              placeholder="0"
              defaultValue={searchParams.get("minPrice") || ""}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams);
                if (e.target.value) {
                  params.set("minPrice", e.target.value);
                } else {
                  params.delete("minPrice");
                }
                params.set("page", "1");
                router.push(`/search?${params.toString()}`, { scroll: false });
              }}
              className="h-8"
            />
          </div>
          <div>
            <Label htmlFor="maxPrice" className="text-xs text-muted-foreground">
              Max price
            </Label>
            <Input
              id="maxPrice"
              type="number"
              placeholder="10000"
              defaultValue={searchParams.get("maxPrice") || ""}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams);
                if (e.target.value) {
                  params.set("maxPrice", e.target.value);
                } else {
                  params.delete("maxPrice");
                }
                params.set("page", "1");
                router.push(`/search?${params.toString()}`, { scroll: false });
              }}
              className="h-8"
            />
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-4 text-sm font-semibold">Rarity</h3>
        <div className="space-y-2">
          {RARITIES.map((rarity) => (
            <div key={rarity.id} className="flex items-center gap-2">
              <Checkbox
                id={`rarity-${rarity.id}`}
                checked={isChecked("rarity", rarity.id)}
                onCheckedChange={(checked) => updateFilter("rarity", rarity.id, checked === true)}
              />
              <Label htmlFor={`rarity-${rarity.id}`} className="text-sm">
                {rarity.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-4 text-sm font-semibold">Condition</h3>
        <div className="space-y-2">
          {CONDITIONS.map((condition) => (
            <div key={condition.id} className="flex items-center gap-2">
              <Checkbox
                id={`condition-${condition.id}`}
                checked={isChecked("condition", condition.id)}
                onCheckedChange={(checked) =>
                  updateFilter("condition", condition.id, checked === true)
                }
              />
              <Label htmlFor={`condition-${condition.id}`} className="text-sm">
                {condition.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-4 text-sm font-semibold">Finish</h3>
        <div className="space-y-2">
          {FINISHES.map((finish) => (
            <div key={finish.id} className="flex items-center gap-2">
              <Checkbox
                id={`finish-${finish.id}`}
                checked={isChecked("finish", finish.id)}
                onCheckedChange={(checked) => updateFilter("finish", finish.id, checked === true)}
              />
              <Label htmlFor={`finish-${finish.id}`} className="text-sm">
                {finish.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-4 text-sm font-semibold">Colour</h3>
        <div className="space-y-2">
          {COLOURS.map((colour) => (
            <div key={colour.id} className="flex items-center gap-2">
              <Checkbox
                id={`colour-${colour.id}`}
                checked={isChecked("colour", colour.id)}
                onCheckedChange={(checked) => updateFilter("colour", colour.id, checked === true)}
              />
              <Label htmlFor={`colour-${colour.id}`} className="text-sm">
                {colour.label}
              </Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
