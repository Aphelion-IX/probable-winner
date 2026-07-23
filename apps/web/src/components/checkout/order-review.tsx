"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
}

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function OrderReview({
  fulfillmentType,
  address,
  storeId,
}: OrderReviewProps) {
  // Mock values - in production, would come from cart
  const subtotal = 299.85;
  const shipping = fulfillmentType === "delivery" ? 15.0 : 0;
  const tax = ((subtotal + shipping) * 0.1).toFixed(2);
  const total = subtotal + shipping + parseFloat(tax as string);

  return (
    <div className="space-y-6">
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
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              3 items from cart (demo)
            </span>
            <span>{priceFormatter.format(subtotal)}</span>
          </div>
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
          <span>{priceFormatter.format(parseFloat(tax as string))}</span>
        </div>
      </div>

      <Separator />

      <div className="flex justify-between font-semibold text-base">
        <span>Total</span>
        <span>{priceFormatter.format(total)}</span>
      </div>

      <Button className="w-full">Proceed to payment</Button>
    </div>
  );
}
