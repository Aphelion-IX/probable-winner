"use client";

import { useState } from "react";
import { FulfillmentMethod } from "@/components/checkout/fulfillment-method";
import { AddressForm } from "@/components/checkout/address-form";
import { StoreSelection } from "@/components/checkout/store-selection";
import { OrderReview } from "@/components/checkout/order-review";

type FulfillmentType = "delivery" | "collect" | null;

export function CheckoutContent() {
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>(null);
  const [selectedAddress, setSelectedAddress] = useState<{
    line1: string;
    line2?: string;
    suburb: string;
    state: string;
    postcode: string;
  } | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);

  // Determine next step based on current state
  let currentStep = 1;
  if (fulfillmentType) currentStep = 2;
  if (fulfillmentType === "delivery" && selectedAddress) currentStep = 3;
  if (fulfillmentType === "collect" && selectedStore) currentStep = 3;

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        {/* Step 1: Fulfillment Method */}
        <div className={`rounded-lg border p-6 ${currentStep > 1 ? "opacity-50" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
              1
            </div>
            <h2 className="text-lg font-semibold">How would you like to receive your order?</h2>
          </div>

          {!fulfillmentType && (
            <FulfillmentMethod
              onSelect={(type) => {
                setFulfillmentType(type);
                // Reset dependent fields when changing fulfillment type
                setSelectedAddress(null);
                setSelectedStore(null);
              }}
            />
          )}

          {fulfillmentType && (
            <div className="mt-4 rounded bg-muted p-3 text-sm">
              {fulfillmentType === "delivery"
                ? "📦 Delivery to your address"
                : "🏪 Click and collect at store"}
              <button
                onClick={() => setFulfillmentType(null)}
                className="ml-2 text-primary hover:underline"
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Address or Store Selection */}
        {fulfillmentType && (
          <div className="rounded-lg border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                2
              </div>
              <h2 className="text-lg font-semibold">
                {fulfillmentType === "delivery" ? "Delivery address" : "Select a store"}
              </h2>
            </div>

            {fulfillmentType === "delivery" ? (
              <AddressForm
                onSubmit={(address) => setSelectedAddress(address)}
                initialValues={selectedAddress || undefined}
              />
            ) : (
              <StoreSelection
                onSelect={(storeId) => setSelectedStore(storeId)}
                selectedStore={selectedStore}
              />
            )}
          </div>
        )}

        {/* Step 3: Review Order */}
        {currentStep === 3 && (
          <div className="rounded-lg border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                3
              </div>
              <h2 className="text-lg font-semibold">Review and pay</h2>
            </div>

            <OrderReview
              fulfillmentType={fulfillmentType}
              address={selectedAddress}
              storeId={selectedStore}
            />
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="space-y-4">
        <div className="rounded-lg border p-4 bg-muted">
          <p className="text-sm font-semibold">Checkout progress</p>
          <div className="mt-4 space-y-2">
            <div
              className={`flex items-center gap-2 text-sm ${currentStep >= 1 ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                ✓
              </span>
              Fulfillment method
            </div>
            <div
              className={`flex items-center gap-2 text-sm ${currentStep >= 2 ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                {currentStep > 2 ? "✓" : "2"}
              </span>
              {fulfillmentType === "delivery" ? "Address" : "Store"}
            </div>
            <div
              className={`flex items-center gap-2 text-sm ${currentStep >= 3 ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                3
              </span>
              Review & pay
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
