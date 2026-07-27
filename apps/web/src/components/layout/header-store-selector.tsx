"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { selectPreferredStore } from "@/app/actions/select-store";

interface Store {
  id: string;
  name: string;
  code: string;
  region: string | null;
}

// Selecting a store here calls selectPreferredStore(), which persists to
// profiles.preferred_fulfilment_node_id (authenticated) or a cookie
// (guest) -- resolveDefaultStore() (backlog B-090/B-170) reads that same
// preference, so this now actually changes which store add-to-cart
// reserves from. Fetched client-side (both /api/stores and
// /api/stores/selected) rather than as Server Component reads in the
// shared layout, same reasoning as the cart badge: reading the cart/store
// cookies there would force every page under the shared layout into
// dynamic rendering, undoing the static caching on the card identity/sets/
// home pages (see docs/architecture.md §10.1).
export function HeaderStoreSelector() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStores() {
      try {
        const [storesResponse, selectedResponse] = await Promise.all([
          fetch("/api/stores"),
          fetch("/api/stores/selected"),
        ]);
        if (cancelled) return;

        const data = storesResponse.ok ? ((await storesResponse.json()) as Store[]) : [];
        if (cancelled) return;
        setStores(data);

        const selected = selectedResponse.ok
          ? ((await selectedResponse.json()) as { storeId: string | null })
          : { storeId: null };
        if (cancelled) return;

        if (selected.storeId && data.some((store) => store.id === selected.storeId)) {
          setSelectedStoreId(selected.storeId);
        } else if (data.length > 0) {
          setSelectedStoreId(data[0].id);
        }
      } catch {
        // No store list available in this environment -- the trigger button
        // still renders, it just has nothing to show when opened.
      }
    }

    void fetchStores();

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = stores.find((store) => store.id === selectedStoreId);

  async function handleSelect(storeId: string) {
    setSelectedStoreId(storeId);
    setOpen(false);

    try {
      const result = await selectPreferredStore(storeId);
      if (!result.success) {
        Sentry.captureMessage(`selectPreferredStore failed: ${result.error}`, { level: "warning" });
      }
    } catch (error) {
      Sentry.captureException(error);
    }
  }

  return (
    <div className="relative hidden lg:block">
      <Button
        variant="ghost"
        size="icon"
        aria-label={selected ? `Store: ${selected.name}` : "Select store"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MapPin />
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-56 rounded-lg border bg-background shadow-lg">
          {stores.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No stores available.</p>
          ) : (
            stores.map((store) => (
              <button
                key={store.id}
                onClick={() => void handleSelect(store.id)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                  store.id === selectedStoreId ? "font-semibold" : ""
                }`}
              >
                {store.name}
                {store.region ? ` · ${store.region}` : ""}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
