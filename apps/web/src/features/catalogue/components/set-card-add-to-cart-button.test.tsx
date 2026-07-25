import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAddToCart = vi.fn();

vi.mock("@/app/actions/add-to-cart", () => ({
  addToCart: (skuId: string, quantity: number) => mockAddToCart(skuId, quantity),
}));

describe("SetCardAddToCartButton", () => {
  beforeEach(() => {
    mockAddToCart.mockReset();
  });

  afterEach(() => cleanup());

  it("adds one unit of the given SKU to the cart", async () => {
    mockAddToCart.mockResolvedValue({ success: true, cartLineId: "line-1" });
    const { SetCardAddToCartButton } = await import("./set-card-add-to-cart-button");

    render(<SetCardAddToCartButton sellableSkuId="sku-1" />);
    fireEvent.click(screen.getByTestId("set-card-add-to-cart"));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledWith("sku-1", 1));
  });

  it("shows an error state when the add fails", async () => {
    mockAddToCart.mockResolvedValue({ success: false, error: "Insufficient stock" });
    const { SetCardAddToCartButton } = await import("./set-card-add-to-cart-button");

    render(<SetCardAddToCartButton sellableSkuId="sku-1" />);
    fireEvent.click(screen.getByTestId("set-card-add-to-cart"));

    await waitFor(() =>
      expect(screen.getByTestId("set-card-add-to-cart")).toHaveAttribute(
        "title",
        "Insufficient stock",
      ),
    );
  });
});
