"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  OAUTH_PROVIDER_LABELS,
  signInWithOAuth,
  type SupportedOAuthProvider,
} from "../sign-in-with-oauth";

// Official provider marks. Drawn inline rather than pulled from an icon set
// because lucide does not ship brand marks, and both Google and Apple require
// their own mark rather than an approximation. Colours are fixed on the Google
// mark (its brand colours are part of the mark); the Apple mark is
// monochrome and inherits currentColor so it stays legible in dark mode.
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.26 3.03-.9.9-1.98 1.42-3.12 1.33-.03-1.09.44-2.2 1.26-3.01.86-.85 2.1-1.44 3.12-1.35zM20.7 17.13c-.54 1.26-.81 1.82-1.5 2.93-.96 1.55-2.31 3.48-3.99 3.49-1.49.02-1.88-.97-3.9-.96-2.02.01-2.44.98-3.94.95-1.68-.02-2.96-1.76-3.92-3.31C.75 16.9.48 11.86 2.19 9.2c1.2-1.9 3.09-3 4.87-3 1.81 0 2.95 1 4.44 1 1.45 0 2.34-1 4.44-1 1.58 0 3.26.86 4.45 2.35-3.91 2.14-3.27 7.72.31 8.58z" />
    </svg>
  );
}

const PROVIDER_MARKS: Record<SupportedOAuthProvider, () => React.JSX.Element> = {
  google: GoogleMark,
  apple: AppleMark,
};

const PROVIDERS: SupportedOAuthProvider[] = ["google", "apple"];

export function OAuthButtons({
  returnTo,
  initialError,
}: {
  returnTo?: string;
  /** Error surfaced by the callback route, e.g. a cancelled or failed sign-in. */
  initialError?: string;
}) {
  // Holds which provider is mid-redirect. Doubles as the "a redirect is in
  // flight" flag, which is what stops a second click from starting a second
  // OAuth flow — the first click navigates away, but the browser stays
  // interactive until it does.
  const [pendingProvider, setPendingProvider] = useState<SupportedOAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function handleSignIn(provider: SupportedOAuthProvider) {
    if (pendingProvider) {
      return;
    }

    setError(null);
    setPendingProvider(provider);

    try {
      await signInWithOAuth(provider, returnTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start sign-in.");
      // Only released on failure. On success the browser is navigating away,
      // and clearing it would briefly re-enable the buttons mid-redirect.
      setPendingProvider(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="oauth-error"
        >
          {error}
        </p>
      ) : null}

      {PROVIDERS.map((provider) => {
        const Mark = PROVIDER_MARKS[provider];
        const isPending = pendingProvider === provider;

        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full justify-center gap-3 text-sm"
            onClick={() => handleSignIn(provider)}
            disabled={pendingProvider !== null}
            aria-busy={isPending}
            data-testid={`oauth-${provider}`}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mark />}
            <span>{OAUTH_PROVIDER_LABELS[provider]}</span>
          </Button>
        );
      })}
    </div>
  );
}
