import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartLineItem } from "./cart-line-item";
import type { CartContentsLine } from "@/features/cart/queries/get-cart-contents";

const mockUpdateCartLineQuantity = vi.fn();
const mockRemoveCartLine = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/features/cart/actions/update-cart-line", () => ({
  updateCartLineQuantity: (id: string, quantity: number) =>
    mockUpdateCartLineQuantity(id, quantity),
  removeCartLine: (id: string) => mockRemoveCartLine(id),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const LINE: CartContentsLine = {
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
  price: 12.5,
  currency: "AUD",
};

describe("CartLineItem", () => {
  beforeEach(() => {
    mockUpdateCartLineQuantity.mockReset();
    mockRemoveCartLine.mockReset();
    mockRefresh.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the card name, price for the current quantity, and finish/condition", () => {
    render(<CartLineItem line={LINE} />);

    expect(screen.getByText("Lightning Bolt")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("Condition: Near Mint")).toBeInTheDocument();
  });

  it("increments the quantity and refreshes the page on success", async () => {
    mockUpdateCartLineQuantity.mockResolvedValue({ success: true });
    render(<CartLineItem line={LINE} />);

    fireEvent.click(screen.getByRole("button", { name: "+" }));

    await waitFor(() => expect(mockUpdateCartLineQuantity).toHaveBeenCalledWith("line-1", 3));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("disables the decrement button at quantity 1", () => {
    render(<CartLineItem line={{ ...LINE, quantity: 1 }} />);

    expect(screen.getByRole("button", { name: "−" })).toBeDisabled();
  });

  it("shows an error message and does not refresh when updating quantity fails", async () => {
    mockUpdateCartLineQuantity.mockResolvedValue({ success: false, error: "insufficient stock" });
    render(<CartLineItem line={LINE} />);

    fireEvent.click(screen.getByRole("button", { name: "+" }));

    await waitFor(() => expect(screen.getByText("insufficient stock")).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("removes the line and refreshes the page on success", async () => {
    mockRemoveCartLine.mockResolvedValue({ success: true });
    render(<CartLineItem line={LINE} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mockRemoveCartLine).toHaveBeenCalledWith("line-1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows an unavailable notice when the SKU has no active price", () => {
    render(<CartLineItem line={{ ...LINE, price: null }} />);

    expect(screen.getByText("This item is no longer available for sale")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
