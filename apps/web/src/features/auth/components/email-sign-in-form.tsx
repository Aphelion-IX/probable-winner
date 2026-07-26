"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OTP_LENGTH, sendEmailOtp, verifyEmailOtp } from "../sign-in-with-email";

type Stage = "email" | "code";

export function EmailSignInForm({
  returnTo,
  initialError,
}: {
  returnTo?: string;
  /** Error handed down by /auth/complete when a sign-in did not stick. */
  initialError?: string;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    setError(null);
    setNotice(null);
    setIsPending(true);

    try {
      await sendEmailOtp(email);
      setStage("code");
      setNotice(`We sent a ${OTP_LENGTH}-digit code to ${email.trim()}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send your sign-in code.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleVerifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    setError(null);
    setIsPending(true);

    try {
      await verifyEmailOtp(email, code);

      // The cookies are written; /auth/complete resolves the profile and
      // decides where this user belongs. Left pending deliberately — the
      // navigation is in flight and re-enabling the button would invite a
      // second submission of a now-consumed code.
      const destination = returnTo
        ? `/auth/complete?next=${encodeURIComponent(returnTo)}`
        : "/auth/complete";

      router.replace(destination);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify your code.");
      setIsPending(false);
    }
  }

  function handleUseDifferentEmail() {
    setStage("email");
    setCode("");
    setError(null);
    setNotice(null);
  }

  const feedback = error ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      data-testid="sign-in-error"
    >
      {error}
    </p>
  ) : notice ? (
    <p
      role="status"
      className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
      data-testid="sign-in-notice"
    >
      {notice}
    </p>
  ) : null;

  if (stage === "email") {
    return (
      <form onSubmit={handleSendCode} className="flex flex-col gap-4">
        {feedback}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoFocus
            required
            placeholder="you@example.com"
            aria-invalid={error ? true : undefined}
          />
        </div>

        <Button
          type="submit"
          className="h-10"
          disabled={isPending}
          aria-busy={isPending}
          data-testid="send-code"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          <span>Email me a sign-in code</span>
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
      {feedback}

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Sign-in code</Label>
        <Input
          id="code"
          name="code"
          // `text` with a numeric inputMode: `number` gets spinners and strips
          // leading zeros, which a zero-padded code cannot survive.
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`[0-9]{${OTP_LENGTH}}`}
          maxLength={OTP_LENGTH}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          autoFocus
          required
          placeholder={"0".repeat(OTP_LENGTH)}
          aria-invalid={error ? true : undefined}
        />
      </div>

      <Button
        type="submit"
        className="h-10"
        disabled={isPending || code.length !== OTP_LENGTH}
        aria-busy={isPending}
        data-testid="verify-code"
      >
        {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        <span>Sign in</span>
      </Button>

      <Button
        type="button"
        variant="ghost"
        className="h-9"
        onClick={handleUseDifferentEmail}
        disabled={isPending}
        data-testid="change-email"
      >
        Use a different email
      </Button>
    </form>
  );
}
