import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { ProfileSetupForm } from "@/features/auth/components/profile-setup-form";
import { requireUser, destinationFor } from "@/server/auth-context";
import { safeRedirectPath } from "@/features/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Finish setting up your account",
};

export const dynamic = "force-dynamic";

export default async function ProfileSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const context = await requireUser("/account/setup");

  const next = destinationFor(context, params.next ? safeRedirectPath(params.next, "") : null);

  // Already set up — nothing to do here. Guards against someone landing on
  // this URL directly and being asked to re-enter a name they already chose.
  if (!context.needsProfileSetup) {
    redirect(next);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finish setting up</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a display name to complete your account.
        </p>
      </div>

      <ProfileSetupForm initialDisplayName={context.displayName ?? ""} next={next} />
    </div>
  );
}
