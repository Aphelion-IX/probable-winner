import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("updateCartLineQuantity", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("rejects a negative quantity without touching the database", async () => {
    const { updateCartLineQuantity } = await import("./update-cart-line");

    const result = await updateCartLineQuantity("line-1", -1);

    expect(result).toEqual({
      success: false,
      error: "Quantity must be a non-negative whole number",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls update_cart_line_quantity with the new quantity", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { updateCartLineQuantity } = await import("./update-cart-line");

    const result = await updateCartLineQuantity("line-1", 5);

    expect(mockRpc).toHaveBeenCalledWith("update_cart_line_quantity", {
      p_cart_line_id: "line-1",
      p_new_quantity: 5,
    });
    expect(result).toEqual({ success: true });
  });

  it("allows a quantity of 0 (removes the line, per the database function)", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { updateCartLineQuantity } = await import("./update-cart-line");

    const result = await updateCartLineQuantity("line-1", 0);

    expect(result).toEqual({ success: true });
  });

  it("surfaces an RPC error", async () => {
    mockRpc.mockResolvedValue({ error: { message: "insufficient stock" } });
    const { updateCartLineQuantity } = await import("./update-cart-line");

    const result = await updateCartLineQuantity("line-1", 5);

    expect(result).toEqual({ success: false, error: "insufficient stock" });
  });
});

describe("removeCartLine", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("calls remove_cart_line with the line id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { removeCartLine } = await import("./update-cart-line");

    const result = await removeCartLine("line-1");

    expect(mockRpc).toHaveBeenCalledWith("remove_cart_line", { p_cart_line_id: "line-1" });
    expect(result).toEqual({ success: true });
  });

  it("surfaces an RPC error", async () => {
    mockRpc.mockResolvedValue({ error: { message: "unknown cart line" } });
    const { removeCartLine } = await import("./update-cart-line");

    const result = await removeCartLine("line-1");

    expect(result).toEqual({ success: false, error: "unknown cart line" });
  });
});
