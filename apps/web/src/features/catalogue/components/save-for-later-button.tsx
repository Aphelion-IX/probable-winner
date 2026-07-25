"use client";

import { useState } from "react";

import { addToSavedList, removeFromSavedList } from "@/features/customer/actions/manage-saved-list";
import { Button } from "@/components/ui/button";

type SaveForLaterButtonProps = {
  sellableSkuId: string;
};

type Status = "idle" | "pending" | "saved" | "unauthenticated" | "error";

export function SaveForLaterButton({ sellableSkuId }: SaveForLaterButtonProps) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick() {
    const wasSaved = status === "saved";
    setStatus("pending");
    try {
      if (wasSaved) {
        await removeFromSavedList(sellableSkuId);
        setStatus("idle");
      } else {
        await addToSavedList(sellableSkuId);
        setStatus("saved");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message === "Not authenticated" ? "unauthenticated" : "error");
    }
  }

  if (status === "unauthenticated") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="save-for-later-status">
        Sign in to your account to save items for later.
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="text-sm text-destructive" data-testid="save-for-later-status">
        Couldn&apos;t update your saved list. Please try again.
      </p>
    );
  }

  return (
    <Button
      type="button"
      variant={status === "saved" ? "secondary" : "outline"}
      size="sm"
      onClick={handleClick}
      disabled={status === "pending"}
      data-testid="save-for-later-button"
    >
      {status === "pending" ? "Saving…" : status === "saved" ? "Saved (remove)" : "Save for later"}
    </Button>
  );
}
