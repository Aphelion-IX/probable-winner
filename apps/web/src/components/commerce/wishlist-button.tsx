"use client";

import { useState } from "react";
import { Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WishlistButton({ className }: { className?: string }) {
  const [saved, setSaved] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved list" : "Add to saved list"}
      className={cn("rounded-full bg-background/80 backdrop-blur hover:bg-background", className)}
      onClick={(event) => {
        event.preventDefault();
        setSaved((value) => !value);
      }}
    >
      <Heart className={cn("size-4", saved && "fill-primary text-primary")} />
    </Button>
  );
}
