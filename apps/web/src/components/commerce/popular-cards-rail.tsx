"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CardTile } from "@/components/commerce/card-tile";
import type { PopularCardItem } from "@/features/catalogue/queries/list-popular-cards";

export function PopularCardsRail({ cards }: { cards: PopularCardItem[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: -1 | 1) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.9, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
      >
        {cards.map((card) => (
          <CardTile
            key={card.printingId}
            href={`/cards/${encodeURIComponent(card.name)}/${card.printingId}`}
            name={card.name}
            setCode={card.setCode}
            setIconUrl={card.setIconUrl}
            rarity={card.rarity}
            price={card.price ?? undefined}
            imageSrc={card.imageUrl ?? undefined}
            className="w-40 shrink-0 snap-start sm:w-48"
          />
        ))}
      </div>

      <div className="mt-2 hidden justify-end gap-1 sm:flex">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
