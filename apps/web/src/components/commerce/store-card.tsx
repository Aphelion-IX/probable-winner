import { MapPin } from "lucide-react";

import type { ClickAndCollectStore } from "@/features/customer/queries/list-click-and-collect-stores";

export function StoreCard({ store }: { store: ClickAndCollectStore }) {
  return (
    <div className="flex gap-3 rounded-lg border p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MapPin className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-medium">{store.name}</p>
        {store.address ? (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {store.address.line1}
            {store.address.city ? `, ${store.address.city}` : ""}
            {store.address.region ? ` ${store.address.region}` : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">Click &amp; collect available</p>
        )}
      </div>
    </div>
  );
}
