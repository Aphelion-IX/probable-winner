"use client";

import { SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SearchFilters, countActiveSearchFilters } from "@/components/search/search-filters";

// The mobile counterpart to search/page.tsx's always-visible desktop
// sidebar (backlog B-092): below the md breakpoint, the same SearchFilters
// controls open in a Sheet from a single "Filters" trigger (with an
// active-count badge) instead of permanently sitting above the results,
// same pattern as features/catalogue/components/set-card-filter-bar.tsx.
export function SearchFilterSheet() {
  const searchParams = useSearchParams();
  const activeCount = countActiveSearchFilters(searchParams);

  return (
    <div className="md:hidden">
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
          <div className="px-4 pb-4">
            <SearchFilters />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
