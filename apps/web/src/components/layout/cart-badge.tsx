"use client";

import { useEffect, useState } from "react";

// Fetched client-side from /api/cart/count rather than read server-side in
// this shared layout component -- see that route's header comment for why
// (reading the cart cookie here would force every page under this layout
// into dynamic rendering, undoing this app's static-caching strategy).
export function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      try {
        const response = await fetch("/api/cart/count", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { count: number };
        if (!cancelled) setCount(data.count);
      } catch {
        // Leave the badge hidden if the count can't be fetched.
      }
    }

    void fetchCount();

    return () => {
      cancelled = true;
    };
  }, []);

  if (count === 0) {
    return null;
  }

  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}
