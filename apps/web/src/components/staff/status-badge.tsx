import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

// Consolidates the hand-rolled bg-yellow-100/bg-blue-100/etc. status color
// maps that were copy-pasted across orders/picking/packing/handover/
// monitoring into one tokenized mapping (Badge's success/warning variants).
const STATUS_TONES: Record<string, BadgeVariant> = {
  pending: "warning",
  in_progress: "secondary",
  confirmed: "secondary",
  processing: "secondary",
  picking: "secondary",
  packed: "secondary",
  labeled: "secondary",
  paid: "success",
  shipped: "success",
  delivered: "success",
  completed: "success",
  ready: "success",
  healthy: "success",
  active: "success",
  cancelled: "destructive",
  failed: "destructive",
  stale: "warning",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONES[status.toLowerCase()] ?? "outline";

  return <Badge variant={tone}>{label ?? status}</Badge>;
}
