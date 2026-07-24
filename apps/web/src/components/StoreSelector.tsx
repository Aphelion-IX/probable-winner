"use client";

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface Store {
  id: string;
  name: string;
}

export function StoreSelector() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function fetchStores() {
      try {
        const response = await fetch("/api/stores");
        if (response.ok) {
          const data = await response.json();
          setStores(data);
          if (data.length > 0) {
            setSelectedStore(data[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch stores:", error);
      }
    }

    fetchStores();
  }, []);

  const selectedStoreData = stores.find((s) => s.id === selectedStore);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-background hover:bg-muted transition"
      >
        <span className="text-sm">{selectedStoreData?.name || "Select store"}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute top-full mt-2 w-48 bg-background border rounded-lg shadow-lg z-50">
          {stores.map((store) => (
            <button
              key={store.id}
              onClick={() => {
                setSelectedStore(store.id);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2 hover:bg-muted transition ${
                selectedStore === store.id ? "bg-muted" : ""
              }`}
            >
              {store.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
