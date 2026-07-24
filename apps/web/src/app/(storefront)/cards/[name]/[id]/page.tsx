import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getCardIdentity } from "@/features/catalogue/queries/get-card-identity";
import { listSkuOptions } from "@/features/catalogue/queries/list-sku-options";
import { SkuSelector } from "@/features/catalogue/components/sku-selector";

type CardIdentityPageProps = {
  params: Promise<{ name: string; id: string }>;
};

const LEGALITY_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  legal: "secondary",
  restricted: "outline",
  banned: "destructive",
  not_legal: "outline",
};

function formatLegalityStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export async function generateMetadata({ params }: CardIdentityPageProps): Promise<Metadata> {
  const { id } = await params;
  const card = await getCardIdentity(id);

  if (!card) {
    return { title: "Card not found" };
  }

  return {
    title: `${card.name} (${card.setCode.toUpperCase()}) — ${card.typeLine}`,
    description: card.oracleText ?? undefined,
  };
}

export default async function CardIdentityPage({ params }: CardIdentityPageProps) {
  const { id } = await params;
  const [card, skuOptions] = await Promise.all([getCardIdentity(id), listSkuOptions(id)]);

  if (!card) {
    notFound();
  }

  const powerToughness =
    card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <Link href="/cards" className="text-sm text-muted-foreground hover:underline">
          ← Back to cards
        </Link>
      </div>

      <div className="grid gap-8 sm:grid-cols-[280px_1fr]">
        <div className="relative aspect-[5/7] w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
          {card.imageUrl ? (
            <Image
              src={card.imageUrl}
              alt={card.name}
              fill
              sizes="280px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-10" aria-hidden />
              <span className="sr-only">No image available</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{card.name}</h1>
            {card.manaCost && <p className="mt-1 text-sm text-muted-foreground">{card.manaCost}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{card.typeLine}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{card.setName}</Badge>
            <span>#{card.collectorNumber}</span>
            <span className="capitalize">{card.rarity}</span>
            {card.artistName && <span>Illustrated by {card.artistName}</span>}
          </div>

          <SkuSelector printingId={card.printingId} options={skuOptions} />

          {card.oracleText && (
            <p className="whitespace-pre-line text-sm leading-relaxed">{card.oracleText}</p>
          )}

          {powerToughness && <p className="text-sm font-medium">{powerToughness}</p>}
          {card.loyalty && <p className="text-sm font-medium">Loyalty: {card.loyalty}</p>}

          {card.flavorText && (
            <p className="text-sm italic text-muted-foreground">{card.flavorText}</p>
          )}
        </div>
      </div>

      {card.legalities.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Format legality</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {card.legalities.map((legality) => (
              <Badge
                key={legality.formatCode}
                variant={LEGALITY_VARIANT[legality.status] ?? "outline"}
              >
                {legality.formatName}: {formatLegalityStatus(legality.status)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {card.relatedPrintings.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Other printings</h2>
            <Link
              href={`/cards/${encodeURIComponent(card.name)}/${card.printingId}/printings`}
              className="text-sm text-muted-foreground hover:underline"
            >
              See all printings →
            </Link>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {card.relatedPrintings.map((printing) => (
              <li key={printing.printingId}>
                <Link
                  href={`/cards/${encodeURIComponent(card.name)}/${printing.printingId}`}
                  className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted"
                >
                  <span>
                    {printing.setName} · #{printing.collectorNumber}
                  </span>
                  <span className="capitalize text-muted-foreground">{printing.rarity}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
