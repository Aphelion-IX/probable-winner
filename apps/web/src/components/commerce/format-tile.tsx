import Link from "next/link";
import { BookOpen, Compass, Coins, Crown, Gem, Layers, Shield, Sparkles } from "lucide-react";

const FORMAT_ICONS: Record<string, typeof Layers> = {
  commander: Crown,
  modern: Sparkles,
  standard: Shield,
  pioneer: Compass,
  legacy: BookOpen,
  vintage: Gem,
  pauper: Coins,
};

export function FormatTile({ code, name }: { code: string; name: string }) {
  const Icon = FORMAT_ICONS[code] ?? Layers;

  return (
    <Link
      href={`/search?format=${encodeURIComponent(code)}`}
      className="group flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:bg-muted"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="text-sm font-medium">{name}</span>
    </Link>
  );
}
