"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeProfileSetup } from "../actions/complete-profile-setup";
import { DISPLAY_NAME_MAX_LENGTH } from "../profile-setup-constants";

export function ProfileSetupForm({
  initialDisplayName,
  next,
}: {
  initialDisplayName: string;
  /** Validated destination to continue to once setup is done. */
  next: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await completeProfileSetup(displayName);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.replace(next);
      // Server Components above this route still hold the pre-setup profile.
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          name="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="nickname"
          autoFocus
          required
          aria-describedby={error ? "display-name-error" : "display-name-hint"}
          aria-invalid={error ? true : undefined}
        />
        <p id="display-name-hint" className="text-xs text-muted-foreground">
          This is how you will appear across the site. You can change it later in your account.
        </p>
      </div>

      {error ? (
        <p
          id="display-name-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="profile-setup-error"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} aria-busy={isPending} className="h-10">
        {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        <span>Continue</span>
      </Button>
    </form>
  );
}
