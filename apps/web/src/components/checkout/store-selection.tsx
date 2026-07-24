"use client";

import { Button } from "@/components/ui/button";
import { MapPin, Check } from "lucide-react";

interface StoreSelectionProps {
  onSelect: (storeId: string) => void;
  selectedStore: string | null;
}

interface Store {
  id: string;
  name: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  phone: string;
  hoursOpen: string;
}

// Mock stores data - in production, would fetch from API
const MOCK_STORES: Store[] = [
  {
    id: "store_1",
    name: "Sydney CBD",
    address: "123 Pitt Street",
    suburb: "Sydney",
    state: "NSW",
    postcode: "2000",
    phone: "(02) 9xxx xxxx",
    hoursOpen: "10am - 6pm, Mon-Sat",
  },
  {
    id: "store_2",
    name: "Westfield Parramatta",
    address: "159-175 Church Street",
    suburb: "Parramatta",
    state: "NSW",
    postcode: "2150",
    phone: "(02) 9xxx xxxx",
    hoursOpen: "10am - 9pm, Daily",
  },
  {
    id: "store_3",
    name: "Melbourne CBD",
    address: "456 Collins Street",
    suburb: "Melbourne",
    state: "VIC",
    postcode: "3000",
    phone: "(03) 9xxx xxxx",
    hoursOpen: "10am - 6pm, Mon-Sat",
  },
];

export function StoreSelection({ onSelect, selectedStore }: StoreSelectionProps) {
  // Initialize with mock data - in production, would fetch from API via useEffect
  const stores = MOCK_STORES;

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
              <p className="text-xs text-muted-foreground mt-1">
                {store.address}, {store.suburb} {store.state} {store.postcode}
              </p>
              <p className="text-xs text-muted-foreground">
                {store.phone} • {store.hoursOpen}
              </p>
            </div>

            {selectedStore === store.id && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                <Check className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
          </div>
        </button>
      ))}

      {selectedStore && (
        <Button className="w-full mt-4">Continue</Button>
      )}
    </div>
  );
}
