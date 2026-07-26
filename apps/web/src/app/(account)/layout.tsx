import type { ReactNode } from "react";

import { StorefrontShell } from "@/components/layout/storefront-shell";
import { requireUser } from "@/server/auth-context";

// Every page in this group is personal data, so the session has to be
// resolved per request — it cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  // Redirects to /login with a return path when signed out. Guarding in the
  // layout means the protected page never renders at all, so there is no
  // flash of account content before the redirect lands.
  //
  // This is for user experience and defence in depth. The actual protection
  // is RLS: profiles, customer_addresses, orders, carts and saved_lists are
  // all scoped to auth.uid(), so even a missed guard returns no rows.
  await requireUser();

  return <StorefrontShell>{children}</StorefrontShell>;
}
