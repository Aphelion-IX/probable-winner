import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutContent } from "./checkout-content";
import type { CartContents } from "@/features/cart/queries/get-cart-contents";
import type { ClickAndCollectStore } from "@/features/customer/queries/list-click-and-collect-stores";

vi.mock("@/app/actions/create-pending-order", () => ({
  createPendingOrder: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const EMPTY_CART: CartContents = { cartId: null, lines: [], subtotal: 0 };

const CART: CartContents = {
  cartId: "cart-1",
  subtotal: 20,
  lines: [
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
  ],
};

const STORES: ClickAndCollectStore[] = [
  { id: "store-1", name: "Geelong", code: "STR-01", region: "VIC", address: null },
];

describe("CheckoutContent", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an empty-cart message instead of the wizard when the cart has no lines", () => {
    render(<CheckoutContent cart={EMPTY_CART} clickAndCollectStores={STORES} />);

    expect(screen.getByText("Your cart is empty")).toBeInTheDocument();
    expect(screen.queryByText("How would you like to receive your order?")).not.toBeInTheDocument();
  });

  it("shows real click-and-collect stores after choosing collect", () => {
    render(<CheckoutContent cart={CART} clickAndCollectStores={STORES} />);

    fireEvent.click(screen.getByText("Click & Collect"));

    expect(screen.getByText("Geelong")).toBeInTheDocument();
  });

  it("reaches the review step with the real cart's items once a store is picked", () => {
    render(<CheckoutContent cart={CART} clickAndCollectStores={STORES} />);

    fireEvent.click(screen.getByText("Click & Collect"));
    fireEvent.click(screen.getByText("Geelong"));

    expect(screen.getByText("Review and pay")).toBeInTheDocument();
    expect(screen.getByText("2× Lightning Bolt (lea)")).toBeInTheDocument();
  });
});
