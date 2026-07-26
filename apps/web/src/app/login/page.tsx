import type { Metadata } from "next";

import { OAuthButtons } from "@/features/auth/components/oauth-buttons";
import { redirectIfSignedIn } from "@/server/auth-context";
import { safeRedirectPath } from "@/features/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Sign in",
};

// Depends on the request's session cookie.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  // Validated here as well as in the callback: this value is echoed into the
  // OAuth redirect, so it must not be trusted just because it came back to us.
  const next = params.next ? safeRedirectPath(params.next, "") || undefined : undefined;

  // Guest-only: an already-signed-in user gets sent on rather than shown a
  // sign-in form they do not need.
  await redirectIfSignedIn(next);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-lg font-semibold tracking-tight">Probable Winner</span>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use your Google or Apple account to continue.
          </p>
        </div>

        <div className="mt-8">
          <OAuthButtons returnTo={next} initialError={params.error} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signing in creates an account if you do not already have one.
        </p>
      </div>
    </main>
  );
}
