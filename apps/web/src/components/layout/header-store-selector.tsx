"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Store {
  id: string;
  name: string;
  code: string;
  region: string | null;
}

// Purely informational for now: there's no durable "customer's preferred
// store" mechanism yet (see docs/architecture.md §11.1) -- selecting a
// store here isn't wired into add-to-cart's fulfilment-node choice or
// checkout's click-and-collect list. This at least replaces a decorative
// button that opened nothing with a real list of the organisation's stores.
export function HeaderStoreSelector() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStores() {
      try {
        const response = await fetch("/api/stores");
        if (!response.ok) return;
        const data = (await response.json()) as Store[];
        if (cancelled) return;
        setStores(data);
        if (data.length > 0) setSelectedStoreId(data[0].id);
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
                onClick={() => {
                  setSelectedStoreId(store.id);
                  setOpen(false);
                }}
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
