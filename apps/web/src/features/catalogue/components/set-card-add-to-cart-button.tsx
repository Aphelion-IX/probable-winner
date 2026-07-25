"use client";

import { useState } from "react";
import { Check, Loader2, ShoppingCart, X } from "lucide-react";

import { addToCart } from "@/app/actions/add-to-cart";
import { Button } from "@/components/ui/button";

type Status = "idle" | "pending" | "added" | "error";

export function SetCardAddToCartButton({ sellableSkuId }: { sellableSkuId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("pending");
    setMessage(null);
    try {
      const result = await addToCart(sellableSkuId, 1);
      if (result.success) {
        setStatus("added");
        setTimeout(() => setStatus("idle"), 1500);
      } else {
        setStatus("error");
        setMessage(result.error ?? "Failed to add to cart");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to add to cart");
    }
  }

  const icon =
    status === "pending" ? (
      <Loader2 className="size-4 animate-spin" />
    ) : status === "added" ? (
      <Check className="size-4" />
    ) : status === "error" ? (
      <X className="size-4" />
    ) : (
      <ShoppingCart className="size-4" />
    );

  return (
    <Button
      type="button"
      size="icon-sm"
      variant={status === "error" ? "destructive" : "default"}
      onClick={handleClick}
      disabled={status === "pending"}
      title={status === "error" ? (message ?? "Failed to add to cart") : "Add to cart"}
      aria-label="Add to cart"
      data-testid="set-card-add-to-cart"
    >
      {icon}
    </Button>
  );
}
