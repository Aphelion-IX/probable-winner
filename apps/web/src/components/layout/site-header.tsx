import Link from "next/link";
import { LogIn, MapPin, Menu, Search, ShoppingCart, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "/search", label: "Search" },
  { href: "/sets", label: "Sets" },
  { href: "/deck-builder", label: "Deck Builder" },
  { href: "/recently-added", label: "Recently Added" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Sheet>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" />
            }
          >
            <Menu />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  {link.label}
                </Link>
              ))}
              <div className="my-2 h-px bg-border" />
              <Link
                href="/account"
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Account
              </Link>
              <Link
                href="/cart"
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Cart
              </Link>
              <div className="my-2 h-px bg-border" />
              <Link
                href="/staff/dashboard"
                className="rounded-md px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
              >
                Admin Dashboard
              </Link>
            </nav>
          </SheetContent>
        </Sheet>

        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
          Probable Winner
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="relative ml-auto hidden max-w-sm flex-1 sm:block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search cards, sets, artists..."
            className="pl-8"
            aria-label="Search"
          />
        </div>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label="Select store"
          >
            <MapPin />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            render={<Link href="/account" aria-label="Account" />}
          >
            <User />
          </Button>
          <Button variant="ghost" size="icon" render={<Link href="/cart" aria-label="Cart" />}>
            <ShoppingCart />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            render={<Link href="/staff/dashboard" aria-label="Admin Dashboard" />}
            className="hidden sm:inline-flex"
            title="Admin Dashboard"
          >
            <LogIn />
          </Button>
        </div>
      </div>
    </header>
  );
}
