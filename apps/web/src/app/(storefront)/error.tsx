"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("Storefront error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="rounded-lg border border-destructive bg-destructive/5 p-8">
        <h1 className="text-xl font-semibold text-destructive">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We encountered an error while loading this page. Please try again.
        </p>
        {error.message && (
          <p className="mt-4 text-xs font-mono text-muted-foreground">
            {error.message}
          </p>
        )}
        <Button onClick={() => reset()} className="mt-6">
          Try again
        </Button>
      </div>
    </div>
  );
}
