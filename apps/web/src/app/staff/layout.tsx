import type { ReactNode } from "react";

import { StaffShell } from "@/components/layout/staff-shell";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffShell>{children}</StaffShell>;
}
