"use client";

import { Button } from "@/components/ui/button";
import { MapPin, Check } from "lucide-react";
import type { ClickAndCollectStore } from "@/features/customer/queries/list-click-and-collect-stores";

interface StoreSelectionProps {
  stores: ClickAndCollectStore[];
  onSelect: (storeId: string) => void;
  selectedStore: string | null;
}

export function StoreSelection({ stores, onSelect, selectedStore }: StoreSelectionProps) {
  if (stores.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stores currently accept click &amp; collect.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {stores.map((store) => (
        <button
          key={store.id}
          onClick={() => onSelect(store.id)}
          className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
            selectedStore === store.id
              ? "border-primary bg-primary/5"
              : "border-transparent hover:border-primary hover:bg-muted"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">{store.name}</h3>
              </div>
              {store.address && (
                <p className="text-xs text-muted-foreground mt-1">
                  {store.address.line1}
                  {store.address.line2 ? `, ${store.address.line2}` : ""}, {store.address.city}
                  {store.address.region ? ` ${store.address.region}` : ""}
                  {store.address.postalCode ? ` ${store.address.postalCode}` : ""}
                </p>
              )}
            </div>

            {selectedStore === store.id && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                <Check className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
          </div>
        </button>
      ))}

      {selectedStore && <Button className="w-full mt-4">Continue</Button>}
    </div>
  );
}
