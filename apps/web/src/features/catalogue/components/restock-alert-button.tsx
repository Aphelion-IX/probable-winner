"use client";

import { useState } from "react";

import { createRestockAlert } from "@/features/customer/actions/manage-alerts";
import { Button } from "@/components/ui/button";

type RestockAlertButtonProps = {
  printingId: string;
  finishCode: string;
  conditionCode: string;
};

// restock_alerts (backlog B-190) predates the sellable-SKU vocabulary this
// page uses and speaks a slightly different one: 'normal' instead of
// 'nonfoil', and uppercase condition codes. Translate at this boundary
// rather than touching that table's already-shipped check constraint.
export function toRestockAlertFinish(finishCode: string): string {
  return finishCode === "nonfoil" ? "normal" : finishCode;
}

export function toRestockAlertCondition(conditionCode: string): string {
  return conditionCode.toUpperCase();
}

type Status = "idle" | "loading" | "success" | "unauthenticated" | "error";

export function RestockAlertButton({
  printingId,
  finishCode,
  conditionCode,
}: RestockAlertButtonProps) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      await createRestockAlert(
        printingId,
        toRestockAlertFinish(finishCode),
        toRestockAlertCondition(conditionCode),
      );
      setStatus("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message === "Not authenticated" ? "unauthenticated" : "error");
    }
  }

  if (status === "success") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="restock-alert-status">
        We&apos;ll email you when this is back in stock.
      </p>
    );
  }

  if (status === "unauthenticated") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="restock-alert-status">
        Sign in to your account to set a restock alert.
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="text-sm text-destructive" data-testid="restock-alert-status">
        Couldn&apos;t set the restock alert. Please try again.
      </p>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={status === "loading"}
      data-testid="restock-alert-button"
    >
      {status === "loading" ? "Setting alert…" : "Notify me when back in stock"}
    </Button>
  );
}
