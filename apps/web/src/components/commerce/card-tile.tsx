import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { WishlistButton } from "@/components/commerce/wishlist-button";
import { cn } from "@/lib/utils";

export type CardTileProps = {
  href: string;
  name: string;
  setCode: string;
  rarity: string;
  condition?: string;
  finish?: "Foil" | "Etched";
  price: number;
  imageSrc?: string;
  className?: string;
};

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function CardTile({
  href,
  name,
  setCode,
  rarity,
  condition,
  finish,
  price,
  imageSrc,
  className,
}: CardTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="relative aspect-square w-full bg-muted">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            sizes="(min-width: 1024px) 200px, 45vw"
            className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" aria-hidden />
            <span className="sr-only">No image available</span>
          </div>
        )}
        {finish && (
          <Badge variant="secondary" className="absolute top-2 left-2">
            {finish}
          </Badge>
        )}
        <WishlistButton className="absolute top-2 right-2" />
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium">{name}</h3>
        <p className="text-xs text-muted-foreground">
          {setCode} · {rarity}
          {condition ? (
            <>
              {" "}
              <Badge variant="outline" className="ml-1 align-middle">
                {condition}
              </Badge>
            </>
          ) : null}
        </p>
        <p className="mt-auto pt-1 text-base font-semibold">{priceFormatter.format(price)}</p>
      </div>
    </Link>
  );
}
