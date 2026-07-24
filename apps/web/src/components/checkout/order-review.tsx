"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createPendingOrder } from "@/app/actions/create-pending-order";
import { AlertCircle, Loader2 } from "lucide-react";
import type { CartContentsLine } from "@/features/cart/queries/get-cart-contents";

interface OrderReviewProps {
  fulfillmentType: "delivery" | "collect" | null;
  address?: {
    line1: string;
    line2?: string;
    suburb: string;
    state: string;
    postcode: string;
  } | null;
  storeId?: string | null;
  cartId: string;
  lines: CartContentsLine[];
  subtotal: number;
}

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function OrderReview({
  fulfillmentType,
  address,
  storeId,
  cartId,
  lines,
  subtotal,
}: OrderReviewProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Array<{ field: string; message: string }>
  >([]);

  // Shipping/tax are flat-rate placeholders -- there's no real shipping-cost
  // calculation or tax-jurisdiction logic yet, matching create-pending-order.ts's
  // own scope. The line items and subtotal above are real, from the cart.
  const shipping = fulfillmentType === "delivery" ? 15.0 : 0;
  const tax = (subtotal + shipping) * 0.1;
  const total = subtotal + shipping + tax;

  const handleCreateOrder = async () => {
    if (!fulfillmentType) {
      setValidationErrors([
        { field: "fulfillmentType", message: "Please select a fulfillment method" },
      ]);
      return;
    }

    setIsLoading(true);
    setValidationErrors([]);

    try {
      const result = await createPendingOrder(
        cartId,
        fulfillmentType,
        fulfillmentType === "delivery" ? address || undefined : undefined,
        fulfillmentType === "collect" ? storeId || undefined : undefined,
      );

      if (result.success && result.orderId) {
        // Navigate to payment page
        router.push(`/checkout/payment/${result.orderId}`);
      } else if (result.errors) {
        setValidationErrors(result.errors);
      }
    } catch (error) {
      setValidationErrors([
        {
          field: "order",
          message: error instanceof Error ? error.message : "Failed to create order",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-lg border border-destructive bg-destructive/5 p-4">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <div className="flex-1">
              <h3 className="font-semibold text-destructive text-sm">Unable to proceed</h3>
              <ul className="mt-2 space-y-1">
                {validationErrors.map((error) => (
                  <li key={error.field} className="text-xs text-destructive">
                    • {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Fulfillment Details */}
      <div className="rounded-lg border p-4 bg-muted/50">
        <h3 className="font-semibold text-sm">
          {fulfillmentType === "delivery" ? "📦 Delivery" : "🏪 Click &amp; Collect"}
        </h3>

        {fulfillmentType === "delivery" && address && (
          <div className="mt-3 text-sm text-muted-foreground">
            <p>{address.line1}</p>
            {address.line2 && <p>{address.line2}</p>}
            <p>
              {address.suburb} {address.state} {address.postcode}
            </p>
          </div>
        )}

        {fulfillmentType === "collect" && storeId && (
          <div className="mt-3 text-sm text-muted-foreground">
            <p>Pickup at selected store</p>
          </div>
        )}
      </div>

      {/* Order Items Preview */}
      <div>
        <h3 className="font-semibold text-sm mb-3">Order items</h3>
        <div className="space-y-2 text-sm">
          {lines.map((line) => (
            <div key={line.cartLineId} className="flex justify-between">
              <span className="text-muted-foreground">
                {line.quantity}× {line.cardName} ({line.setCode})
              </span>
              <span>
                {line.price != null
                  ? priceFormatter.format(line.price * line.quantity)
                  : "Unavailable"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Price Breakdown */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{priceFormatter.format(subtotal)}</span>
        </div>

        {shipping > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shipping</span>
            <span>{priceFormatter.format(shipping)}</span>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax (10%)</span>
          <span>{priceFormatter.format(tax)}</span>
        </div>
      </div>

      <Separator />

      <div className="flex justify-between font-semibold text-base">
        <span>Total</span>
        <span>{priceFormatter.format(total)}</span>
      </div>

      <Button
        onClick={handleCreateOrder}
        disabled={isLoading || !fulfillmentType}
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating order...
          </>
        ) : (
          "Proceed to payment"
        )}
      </Button>
    </div>
  );
}
