import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  href,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  href?: string;
  tone?: "primary" | "destructive";
}) {
  const content = (
    <div className="flex h-full items-start justify-between rounded-lg border bg-card p-6 transition-colors hover:bg-muted/50">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold">{value}</p>
      </div>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          tone === "destructive"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
    </div>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}
