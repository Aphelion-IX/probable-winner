import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderReview } from "./order-review";
import type { CartContentsLine } from "@/features/cart/queries/get-cart-contents";

const mockCreatePendingOrder = vi.fn();
const mockPush = vi.fn();

vi.mock("@/app/actions/create-pending-order", () => ({
  createPendingOrder: (...args: unknown[]) => mockCreatePendingOrder(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const LINES: CartContentsLine[] = [
  {
    cartLineId: "line-1",
    cartId: "cart-1",
    sellableSkuId: "sku-1",
    fulfilmentNodeId: "node-1",
    quantity: 2,
    reservationExpiresAt: "2026-08-01T00:00:00Z",
    cardName: "Lightning Bolt",
    setCode: "lea",
    rarity: "common",
    finishCode: "nonfoil",
    finishName: "Nonfoil",
    conditionCode: "nm",
    conditionName: "Near Mint",
    price: 10,
    currency: "AUD",
  },
];

describe("OrderReview", () => {
  beforeEach(() => {
    mockCreatePendingOrder.mockReset();
    mockPush.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders real order lines and computes subtotal/tax/total from the cart", () => {
    render(
      <OrderReview
        fulfillmentType="collect"
        storeId="store-1"
        cartId="cart-1"
        lines={LINES}
        subtotal={20}
      />,
    );

    expect(screen.getByText("2× Lightning Bolt (lea)")).toBeInTheDocument();
    // Click & collect: no shipping. Tax = 10% of 20 = 2. Total = 22.
    expect(screen.getByText("$2.00")).toBeInTheDocument();
    expect(screen.getByText("$22.00")).toBeInTheDocument();
  });

  it("adds flat-rate shipping and tax on top for delivery", () => {
    render(
      <OrderReview
        fulfillmentType="delivery"
        address={{ line1: "1 Main St", suburb: "Sydney", state: "NSW", postcode: "2000" }}
        cartId="cart-1"
        lines={LINES}
        subtotal={20}
      />,
    );

    // Shipping = 15. Tax = 10% of (20 + 15) = 3.5. Total = 38.5.
    expect(screen.getByText("$15.00")).toBeInTheDocument();
    expect(screen.getByText("$3.50")).toBeInTheDocument();
    expect(screen.getByText("$38.50")).toBeInTheDocument();
  });

  it("submits the real cartId to createPendingOrder and navigates to payment on success", async () => {
    mockCreatePendingOrder.mockResolvedValue({ success: true, orderId: "order-1" });
    render(
      <OrderReview
        fulfillmentType="collect"
        storeId="store-1"
        cartId="cart-1"
        lines={LINES}
        subtotal={20}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Proceed to payment" }));

    await waitFor(() =>
      expect(mockCreatePendingOrder).toHaveBeenCalledWith(
        "cart-1",
        "collect",
        undefined,
        "store-1",
      ),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/checkout/payment/order-1"));
  });

  it("shows validation errors returned by createPendingOrder instead of navigating", async () => {
    mockCreatePendingOrder.mockResolvedValue({
      success: false,
      errors: [{ field: "cart", message: "Cart is empty" }],
    });
    render(
      <OrderReview
        fulfillmentType="collect"
        storeId="store-1"
        cartId="cart-1"
        lines={LINES}
        subtotal={20}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Proceed to payment" }));

    await waitFor(() => expect(screen.getByText(/Cart is empty/)).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
