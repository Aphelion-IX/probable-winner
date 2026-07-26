import type { ReactNode } from "react";

import { StaffShell } from "@/components/layout/staff-shell";
import { requireStaff } from "@/server/auth-context";

// Staff access depends on the request's session and the caller's
// staff_memberships row, so these pages cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  // Signed out -> /login with a return path. Signed in but not staff -> home.
  //
  // Membership is read from staff_memberships, never from the email address,
  // the email domain, or user_metadata: signing in grants nothing here on its
  // own. Individual screens additionally check their own
  // permission code, and every table behind them is protected by RLS policies
  // that re-check the same membership.
  await requireStaff();

  return <StaffShell>{children}</StaffShell>;
}
