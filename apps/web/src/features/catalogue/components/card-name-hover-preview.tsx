"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

type CardNameHoverPreviewProps = {
  href: string;
  name: string;
  imageUrl: string | null;
  className?: string;
};

// Positioned `fixed` off the hovered link's own bounding rect, computed on
// hover, rather than an absolutely-positioned child of a `relative`
// wrapper: this table is wrapped in an `overflow-x-auto` container for
// mobile (same as saved-lists/page.tsx's table), and `overflow-x` other
// than visible forces the browser to compute `overflow-y` as non-visible
// too -- a plain CSS popup would get clipped vertically by that container.
export function CardNameHoverPreview({
  href,
  name,
  imageUrl,
  className,
}: CardNameHoverPreviewProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [preview, setPreview] = useState<{ top: number; left: number } | null>(null);

  function showPreview() {
    if (!imageUrl) return;
    const rect = linkRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPreview({ top: rect.top, left: rect.right + 12 });
  }

  return (
    <>
      <Link
        ref={linkRef}
        href={href}
        className={cn("hover:underline", className)}
        onMouseEnter={showPreview}
        onMouseLeave={() => setPreview(null)}
        onFocus={showPreview}
        onBlur={() => setPreview(null)}
      >
        {name}
      </Link>

      {preview && imageUrl && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border bg-card shadow-xl"
          style={{ top: preview.top, left: preview.left }}
        >
          <Image src={imageUrl} alt={name} width={180} height={252} className="object-cover" />
        </div>
      )}
    </>
  );
}
