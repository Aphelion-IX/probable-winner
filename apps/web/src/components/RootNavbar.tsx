"use client";

import Link from "next/link";
import { ShoppingCart, Search, User } from "lucide-react";
import { StoreSelector } from "./StoreSelector";

export function RootNavbar() {
  return (
    <nav className="border-b bg-background sticky top-0 z-40">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="font-bold text-lg shrink-0">
          Probable Winner
        </Link>

        <StoreSelector />

        <div className="flex items-center gap-4 ml-auto">
          <div className="hidden md:flex relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search cards..."
              className="pl-10 pr-4 py-2 rounded-lg border bg-background text-sm w-48"
            />
          </div>

          <Link href="/cart" className="relative p-2 hover:bg-muted rounded-lg transition">
            <ShoppingCart className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-xs font-bold">
              0
            </span>
          </Link>

          <Link href="/account" className="p-2 hover:bg-muted rounded-lg transition">
            <User className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
