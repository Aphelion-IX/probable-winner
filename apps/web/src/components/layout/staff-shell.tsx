import type { ReactNode } from "react";
import Link from "next/link";
import { LayoutDashboard, Menu, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StaffSidebarNav } from "@/components/layout/staff-sidebar-nav";
import { getStaffContext } from "@/server/staff-context";

const SCOPE_LABELS: Record<string, string> = {
  store: "Single store",
  selected_stores: "Selected stores",
  region: "Regional",
  all_stores: "All stores",
  organisation: "Organisation-wide",
};

// Takes the scope rather than fetching it: StaffShell already resolves the
// staff context to filter the nav, and this used to re-resolve it for a
// single label — two auth round trips per page render for one string.
function StaffScopeBadge({ scopeType }: { scopeType: string | null }) {
  if (!scopeType) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Store className="size-3.5 shrink-0" aria-hidden />
      <span>{SCOPE_LABELS[scopeType] ?? scopeType}</span>
    </div>
  );
}

function StaffBrand() {
  return (
    <Link
      href="/staff/dashboard"
      className="flex items-center gap-2 px-1 font-semibold tracking-tight"
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <LayoutDashboard className="size-4" aria-hidden />
      </span>
      Staff Portal
    </Link>
  );
}

export async function StaffShell({ children }: { children: ReactNode }) {
  // Nav is filtered to what this member's role actually grants, so the
  // sidebar stops advertising screens whose every action would be refused.
  // Presentation only — the screens and RLS still enforce access.
  const staffContext = await getStaffContext();
  const permissions = staffContext?.permissions ?? [];

  return (
    <div className="flex min-h-svh flex-col bg-muted/20 lg:flex-row">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-white/10 bg-background/60 px-4 backdrop-blur-xl sm:px-6 lg:hidden">
        <Sheet>
          <SheetTrigger
            render={<Button variant="ghost" size="icon" aria-label="Open staff menu" />}
          >
            <Menu />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Staff Portal</SheetTitle>
            </SheetHeader>
            <div className="p-4">
              <StaffSidebarNav permissions={permissions} />
            </div>
          </SheetContent>
        </Sheet>
        <StaffBrand />
      </header>

      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-white/10 bg-background/40 p-4 backdrop-blur-xl lg:flex">
        <StaffBrand />
        <div className="flex-1 overflow-y-auto">
          <StaffSidebarNav permissions={permissions} />
        </div>
        <StaffScopeBadge scopeType={staffContext?.scopeType ?? null} />
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-screen-2xl">{children}</div>
      </main>
    </div>
  );
}
