import Link from "next/link";
import { MapPin, PackageSearch, Search, ShieldCheck, Sparkles, Truck, Upload } from "lucide-react";

import { Input } from "@/components/ui/input";
import { FormatTile } from "@/components/commerce/format-tile";
import { HeroCardCollage } from "@/components/commerce/hero-card-collage";
import { PopularCardsRail } from "@/components/commerce/popular-cards-rail";
import { StoreCard } from "@/components/commerce/store-card";
import { listPopularCards } from "@/features/catalogue/queries/list-popular-cards";
import { listFeaturedFormats } from "@/features/catalogue/queries/list-formats";
import { listClickAndCollectStores } from "@/features/customer/queries/list-click-and-collect-stores";

const TRUST_BADGES = [
  { icon: Truck, label: "Fast dispatch", detail: "Shipped from your closest store" },
  { icon: ShieldCheck, label: "Secure packaging", detail: "Cards protected in transit" },
  { icon: MapPin, label: "Click & collect", detail: "Pick up in-store, same day" },
  { icon: PackageSearch, label: "Live stock", detail: "Real availability, every store" },
];

const UTILITY_TILES = [
  {
    href: "/sets",
    icon: Sparkles,
    title: "Browse sets",
    description: "Explore the full catalogue by set and release date.",
  },
  {
    href: "/deck-builder",
    icon: Upload,
    title: "Paste a deck list",
    description: "Add every card you need to your cart in one go.",
  },
  {
    href: "/recently-added",
    icon: PackageSearch,
    title: "Recently added",
    description: "See what just landed across the warehouse and stores.",
  },
];

export default async function Home() {
  // Each section below already has its own "nothing to show" fallback UI, so
  // a failure in one independent fetch degrades just that section instead
  // of crashing the whole page (backlog B-093: no bare blank screens/crashes
  // during load) -- same reasoning as search-results.tsx's catch.
  const [popularCards, formats, stores] = await Promise.all([
    listPopularCards().catch(() => []),
    listFeaturedFormats().catch(() => []),
    listClickAndCollectStores().catch(() => []),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-16 px-4 py-10 sm:px-6 sm:py-16">
      <section className="grid grid-cols-1 items-center gap-10 sm:grid-cols-2 sm:gap-8">
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            One catalogue.
            <br />
            <span className="text-primary">One fast search.</span>
            <br />
            One checkout.
          </h1>
          <p className="max-w-lg text-base text-muted-foreground sm:text-lg">
            Find any card, check store availability, and get it delivered or ready for click and
            collect.
          </p>
          <form action="/search" method="GET" className="relative w-full max-w-lg">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              placeholder="Search cards, sets, artists..."
              className="h-11 pl-9 text-base"
              aria-label="Search"
            />
          </form>
        </div>

        {popularCards.length > 0 && (
          <div className="hidden sm:block">
            <HeroCardCollage cards={popularCards} />
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {TRUST_BADGES.map(({ icon: Icon, label, detail }) => (
          <div key={label} className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{detail}</p>
            </div>
          </div>
        ))}
      </section>

      {popularCards.length > 0 ? (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Popular right now</h2>
            <Link href="/search" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <PopularCardsRail cards={popularCards} />
        </section>
      ) : (
        <section className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No cards have been imported yet — the catalogue importer (backlog Step 5) hasn&apos;t run
          against this environment yet. See <code>docs/backlog.md</code>.
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {UTILITY_TILES.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-3 rounded-lg border p-6 transition-colors hover:bg-muted"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
          </Link>
        ))}
      </section>

      {formats.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Shop by format</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {formats.map((format) => (
              <FormatTile key={format.code} code={format.code} name={format.name} />
            ))}
          </div>
        </section>
      )}

      {stores.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Shop by store</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Choose a store to see local availability and click &amp; collect options.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stores.map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
