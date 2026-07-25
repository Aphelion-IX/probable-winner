"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { visibleNavSections } from "@/components/layout/staff-nav-links";

/**
 * Takes the viewer's permission codes and does the filtering here rather
 * than receiving ready-made sections from the server: nav links carry a
 * Lucide `icon` component, and React cannot serialise a function across the
 * server/client boundary. Permission codes are plain strings, so they cross
 * it fine and the icons never leave the client bundle.
 */
export function StaffSidebarNav({
  permissions,
  onNavigate,
}: {
  permissions: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = visibleNavSections(permissions);

  return (
    <nav className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {section.label}
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            {section.links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <link.icon className="size-4" aria-hidden />
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
