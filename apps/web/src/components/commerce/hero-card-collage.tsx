import Image from "next/image";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PopularCardItem } from "@/features/catalogue/queries/list-popular-cards";

const SLOT_STYLES = [
  "left-[8%] top-[18%] w-[42%] -rotate-6",
  "left-[38%] top-0 w-[42%] rotate-3",
  "left-[30%] top-[38%] w-[42%] -rotate-2",
];

// Built from real catalogue cards (the same rail below), not stock art --
// we don't have a licensed hero illustration, so this collages up to three
// of the actual popular-card images (or the same ImageOff placeholder
// CardTile uses, if a card has no image) instead of fabricating one.
export function HeroCardCollage({ cards }: { cards: PopularCardItem[] }) {
  const slots = cards.slice(0, 3);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-md">
      <div className="absolute inset-8 rounded-full bg-primary/10 blur-2xl" aria-hidden />
      {slots.map((card, index) => (
        <div
          key={card.printingId}
          className={cn(
            "absolute aspect-[5/7] overflow-hidden rounded-xl border bg-card shadow-lg",
            SLOT_STYLES[index],
          )}
        >
          {card.imageUrl ? (
            <Image
              src={card.imageUrl}
              alt={card.name}
              fill
              sizes="(min-width: 640px) 240px, 45vw"
              className="object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
              <ImageOff className="size-8" aria-hidden />
              <span className="sr-only">{card.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
