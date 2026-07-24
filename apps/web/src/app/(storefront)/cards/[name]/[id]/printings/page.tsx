import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getCardIdentity } from "@/features/catalogue/queries/get-card-identity";
import { listPrintingsForOracleCard } from "@/features/catalogue/queries/list-printings-for-oracle-card";

type AllPrintingsPageProps = {
  params: Promise<{ name: string; id: string }>;
};

export async function generateMetadata({ params }: AllPrintingsPageProps): Promise<Metadata> {
  const { id } = await params;
  const card = await getCardIdentity(id);

  if (!card) {
    return { title: "Card not found" };
  }

  return { title: `All printings of ${card.name}` };
}

export default async function AllPrintingsPage({ params }: AllPrintingsPageProps) {
  const { id } = await params;
  const card = await getCardIdentity(id);

  if (!card) {
    notFound();
  }

  const printings = await listPrintingsForOracleCard(card.oracleCardId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <Link
          href={`/cards/${encodeURIComponent(card.name)}/${id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to {card.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">All printings of {card.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {printings.length} printing{printings.length === 1 ? "" : "s"}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {printings.map((printing) => (
          <li key={printing.printingId}>
            <Link
              href={`/cards/${encodeURIComponent(card.name)}/${printing.printingId}`}
              className="flex items-center gap-4 rounded-lg border p-3 hover:bg-muted"
            >
              <div className="relative aspect-[5/7] w-14 shrink-0 overflow-hidden rounded border bg-muted">
                {printing.thumbnailUrl ? (
                  <Image
                    src={printing.thumbnailUrl}
                    alt={`${card.name} — ${printing.setName}`}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-4" aria-hidden />
                    <span className="sr-only">No image available</span>
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{printing.setName}</span>
                  <span className="text-muted-foreground">#{printing.collectorNumber}</span>
                  {printing.printingId === id && (
                    <Badge variant="secondary">Currently viewing</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{printing.rarity}</span>
                  {printing.releasedAt && (
                    <span>{new Date(printing.releasedAt).toLocaleDateString("en-AU")}</span>
                  )}
                  {printing.finishes.map((finish) => (
                    <Badge key={finish} variant="outline" className="capitalize">
                      {finish}
                    </Badge>
                  ))}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
