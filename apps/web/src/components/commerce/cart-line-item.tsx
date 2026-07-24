"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { AlertCircle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removeCartLine, updateCartLineQuantity } from "@/features/cart/actions/update-cart-line";
import type { CartContentsLine } from "@/features/cart/queries/get-cart-contents";

interface CartLineItemProps {
  line: CartContentsLine;
}

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function CartLineItem({ line }: CartLineItemProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeQuantity(newQuantity: number) {
    setPending(true);
    setError(null);
    try {
      const result = await updateCartLineQuantity(line.cartLineId, newQuantity);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update quantity");
      Sentry.captureException(err);
    } finally {
      setPending(false);
    }
  }

  async function handleRemove() {
    setPending(true);
    setError(null);
    try {
      const result = await removeCartLine(line.cartLineId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove item");
      Sentry.captureException(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="flex items-start gap-2">
            <div>
              <h3 className="font-medium">{line.cardName}</h3>
              <p className="text-xs text-muted-foreground">
                {line.setCode} · {line.rarity}
                {line.finishCode !== "nonfoil" && (
                  <>
                    {" "}
                    <Badge variant="outline" className="ml-1">
                      {line.finishName}
                    </Badge>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">Condition: {line.conditionName}</p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {line.price == null && (
              <div className="flex items-center gap-2 rounded bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-100">
                <AlertCircle className="size-4 shrink-0" />
                <span>This item is no longer available for sale</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-100">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {line.price != null && line.reservationExpiresAt && (
              <p className="text-xs text-muted-foreground">
                Reserved until {dateFormatter.format(new Date(line.reservationExpiresAt))}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 text-right">
          <div className="text-lg font-semibold">
            {line.price != null ? priceFormatter.format(line.price * line.quantity) : "Unavailable"}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={pending || line.quantity <= 1}
              onClick={() => changeQuantity(line.quantity - 1)}
            >
              −
            </Button>
            <Input
              type="number"
              min="1"
              value={line.quantity}
              className="h-8 w-12 text-center p-0"
              readOnly
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={pending}
              onClick={() => changeQuantity(line.quantity + 1)}
            >
              +
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove"
            className="h-8 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={handleRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
