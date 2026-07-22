import Link from "next/link";
import { Search } from "lucide-react";

import { CardTile, type CardTileProps } from "@/components/commerce/card-tile";
import { Input } from "@/components/ui/input";

// Preview-only demo content — no catalogue exists yet (backlog Phase 1).
// Not real inventory; remove once /cards is backed by real data.
const SAMPLE_CARDS: CardTileProps[] = [
  {
    href: "/cards",
    name: "Jeweled Lotus",
    setCode: "FDN",
    rarity: "Mythic",
    condition: "NM",
    price: 189.95,
  },
  {
    href: "/cards",
    name: "Mana Crypt",
    setCode: "FDN",
    rarity: "Mythic",
    condition: "NM",
    price: 249.95,
  },
  {
    href: "/cards",
    name: "Cavern of Souls",
    setCode: "FDN",
    rarity: "Mythic",
    condition: "NM",
    price: 89.95,
  },
  {
    href: "/cards",
    name: "Doubling Season",
    setCode: "FDN",
    rarity: "Rare",
    condition: "NM",
    price: 48.95,
  },
  {
    href: "/cards",
    name: "Sol Ring",
    setCode: "FDN",
    rarity: "Uncommon",
    condition: "NM",
    price: 12.5,
  },
  {
    href: "/cards",
    name: "Command Tower",
    setCode: "FDN",
    rarity: "Common",
    condition: "NM",
    price: 2.95,
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-12 sm:px-6 sm:py-20">
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
          One catalogue. One fast search. One checkout.
        </h1>
        <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
          Find any card, check store availability, and get it delivered or ready for click and
          collect.
        </p>
        <form className="relative w-full max-w-lg">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search cards, sets, artists..."
            className="h-11 pl-9 text-base"
            aria-label="Search"
          />
        </form>
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-lg font-semibold">Popular right now</h2>
          <span className="text-xs text-muted-foreground">
            Preview layout — sample cards, not live inventory
          </span>
        </div>
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
          {SAMPLE_CARDS.map((card) => (
            <CardTile key={card.name} {...card} className="w-40 shrink-0 snap-start sm:w-48" />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/sets" className="rounded-lg border p-6 transition-colors hover:bg-muted">
          <h2 className="font-medium">Browse sets</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore the full catalogue by set and release date.
          </p>
        </Link>
        <Link
          href="/deck-builder"
          className="rounded-lg border p-6 transition-colors hover:bg-muted"
        >
          <h2 className="font-medium">Paste a deck list</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add every card you need to your cart in one go.
          </p>
        </Link>
        <Link
          href="/recently-added"
          className="rounded-lg border p-6 transition-colors hover:bg-muted"
        >
          <h2 className="font-medium">Recently added</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            See what just landed across the warehouse and stores.
          </p>
        </Link>
      </section>

      <section className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Catalogue and inventory data are not connected yet — this is the storefront shell only
        (backlog Phase 2, Step 10). See <code>docs/backlog.md</code>
        {" for what's next."}
      </section>
    </div>
  );
}
