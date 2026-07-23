"use client";

import { Package, Store } from "lucide-react";

interface FulfillmentMethodProps {
  onSelect: (type: "delivery" | "collect") => void;
}

export function FulfillmentMethod({ onSelect }: FulfillmentMethodProps) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <button
        onClick={() => onSelect("delivery")}
        className="rounded-lg border-2 border-transparent p-4 text-left transition-colors hover:border-primary hover:bg-muted"
      >
        <div className="flex items-start gap-3">
          <Package className="h-6 w-6 text-primary" />
          <div>
            <h3 className="font-semibold">Delivery</h3>
            <p className="text-xs text-muted-foreground">
              We&apos;ll ship your order to your address
            </p>
          </div>
        </div>
      </button>

      <button
        onClick={() => onSelect("collect")}
        className="rounded-lg border-2 border-transparent p-4 text-left transition-colors hover:border-primary hover:bg-muted"
      >
        <div className="flex items-start gap-3">
          <Store className="h-6 w-6 text-primary" />
          <div>
            <h3 className="font-semibold">Click &amp; Collect</h3>
            <p className="text-xs text-muted-foreground">
              Pick up at your nearest store
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}
