import type { Metadata } from "next";

import { EmailSignInForm } from "@/features/auth/components/email-sign-in-form";
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

  // Validated here as well as in /auth/complete: this value is handed to the
  // sign-in form and echoed back into a redirect, so it is never trusted just
  // because it arrived in a URL.
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
            Enter your email and we&apos;ll send you a sign-in code. No password needed.
          </p>
        </div>

        <div className="mt-8">
          <EmailSignInForm returnTo={next} initialError={params.error} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signing in creates an account if you do not already have one.
        </p>
      </div>
    </main>
  );
}
