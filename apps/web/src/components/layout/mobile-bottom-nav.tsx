"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, Search, ShoppingCart, Star, User } from "lucide-react";

import { CartBadge } from "@/components/layout/cart-badge";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/sets", label: "Shop", icon: Layers, exact: false },
  { href: "/search", label: "Search", icon: Search, exact: false },
  { href: "/account/saved-lists", label: "Lists", icon: Star, exact: false },
  { href: "/account", label: "Account", icon: User, exact: false },
  { href: "/cart", label: "Cart", icon: ShoppingCart, exact: false },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-background/50 backdrop-blur-xl supports-backdrop-filter:bg-background/40 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-6">
        {TABS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 py-2 text-[0.65rem] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {href === "/cart" && <CartBadge />}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
