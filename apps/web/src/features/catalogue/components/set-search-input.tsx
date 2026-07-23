"use client";

import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 300;

export function SetSearchInput() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search sets by name or code..."
        defaultValue={searchParams.get("q") ?? ""}
        className="pl-8"
        aria-label="Search sets"
        onChange={(event) => {
          const value = event.target.value;
          if (debounceRef.current) clearTimeout(debounceRef.current);

          debounceRef.current = setTimeout(() => {
            const params = new URLSearchParams(searchParams.toString());
            if (value) {
              params.set("q", value);
            } else {
              params.delete("q");
            }
            const query = params.toString();
            router.push(query ? `${pathname}?${query}` : pathname);
          }, DEBOUNCE_MS);
        }}
      />
    </div>
  );
}
