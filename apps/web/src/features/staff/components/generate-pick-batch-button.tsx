"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { generatePickBatch } from "@/features/staff/actions/generate-pick-batch";
import { Button } from "@/components/ui/button";

export function GeneratePickBatchButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const result = await generatePickBatch();
      if (!result.success || !result.batchId) {
        setError(result.error ?? "Failed to generate pick batch");
        return;
      }
      router.push(`/staff/picking/${result.batchId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate pick batch");
      Sentry.captureException(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? "Generating…" : "Generate pick batch"}
      </Button>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
