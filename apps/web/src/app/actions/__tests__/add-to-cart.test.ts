import { describe, it, expect } from "vitest";
import { addToCart } from "../add-to-cart";

describe("addToCart", () => {
  it("should export addToCart function", () => {
    expect(typeof addToCart).toBe("function");
  });

  it("should return result object", async () => {
    const result = await addToCart("cart-id", "sku-id", 1, "node-id");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("error");
  });
});
