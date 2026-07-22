import Link from "next/link";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

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
