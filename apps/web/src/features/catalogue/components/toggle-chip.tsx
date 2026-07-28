"use client";

import { cn } from "@/lib/utils";

// Shared pressed/unpressed filter chip -- used by SetCardFilterBar so the
// colour/finish/etc. filter chips look and behave consistently.
export function ToggleChip({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-all outline-none",
        "hover:border-ring/60 hover:shadow-[0_0_8px_var(--color-ring)]",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:shadow-[0_0_12px_var(--color-ring)]",
        active ? "ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100",
        className,
      )}
    >
      {label}
    </button>
  );
}
