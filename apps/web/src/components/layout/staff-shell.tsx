import type { ReactNode } from "react";

import { StaffHeader } from "@/components/layout/staff-header";

export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/20">
      <StaffHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
