import { cn } from "@/lib/utils";

type SetIconProps = {
  url: string | null | undefined;
  alt: string;
  className?: string;
};

// Plain <img>, not next/image: these are small hotlinked SVGs (Scryfall's
// expansion-symbol icons) where next/image's resize/format pipeline adds
// nothing, and using it would require flipping images.dangerouslyAllowSVG
// repo-wide (next.config.ts) just for this one asset type. Renders nothing
// when there's no icon yet (sets.icon_url is only populated once
// apps/worker's import-set-symbols job has run against a set) rather than
// showing a placeholder.
export function SetIcon({ url, alt, className }: SetIconProps) {
  if (!url) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see file comment
    <img
      src={url}
      alt={alt}
      className={cn("inline-block size-4 shrink-0 align-middle", className)}
      aria-hidden={alt === ""}
    />
  );
}
