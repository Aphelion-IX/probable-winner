import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

const USER = { id: "customer-1" };

function savedListLinesChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      order: () => ({
        returns: () => Promise.resolve(returnValue),
      }),
    }),
  };
}

function inChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      in: () => ({
        eq: () => Promise.resolve(returnValue),
        then: (resolve: (value: typeof returnValue) => void) => resolve(returnValue),
      }),
    }),
  };
}

describe("manage-saved-list", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
  });

  describe("addToSavedList", () => {
    it("calls the add_to_saved_list RPC with the given SKU", async () => {
      mockRpc.mockResolvedValue({ data: "line-1", error: null });
      const { addToSavedList } = await import("./manage-saved-list");

      await addToSavedList("sku-1");

      expect(mockRpc).toHaveBeenCalledWith("add_to_saved_list", { p_sellable_sku_id: "sku-1" });
    });

    it("throws when not authenticated, without calling the RPC", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { addToSavedList } = await import("./manage-saved-list");

      await expect(addToSavedList("sku-1")).rejects.toThrow("Not authenticated");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("surfaces an RPC error as a thrown error", async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
      const { addToSavedList } = await import("./manage-saved-list");

      await expect(addToSavedList("sku-1")).rejects.toThrow("Failed to add item to saved list");
    });
  });

  describe("removeFromSavedList", () => {
    it("calls the remove_from_saved_list RPC with the given SKU", async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });
      const { removeFromSavedList } = await import("./manage-saved-list");

      await removeFromSavedList("sku-1");

      expect(mockRpc).toHaveBeenCalledWith("remove_from_saved_list", {
        p_sellable_sku_id: "sku-1",
      });
    });

    it("throws when not authenticated, without calling the RPC", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { removeFromSavedList } = await import("./manage-saved-list");

      await expect(removeFromSavedList("sku-1")).rejects.toThrow("Not authenticated");
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe("getSavedList", () => {
    it("returns an empty array when nothing is saved, without querying prices/balances", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "saved_list_lines") {
          return savedListLinesChain({ data: [], error: null });
        }
        throw new Error(`unexpected table: ${table}`);
      });
      const { getSavedList } = await import("./manage-saved-list");

      const result = await getSavedList();

      expect(result).toEqual([]);
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it("throws when not authenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { getSavedList } = await import("./manage-saved-list");

      await expect(getSavedList()).rejects.toThrow("Not authenticated");
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("joins card details with batched price/availability lookups", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "saved_list_lines") {
          return savedListLinesChain({
            data: [
              {
                sellable_sku_id: "sku-1",
                sellable_skus: {
                  finishes: { code: "nonfoil" },
                  conditions: { code: "nm" },
                  card_printing: {
                    id: "printing-1",
                    rarity: "rare",
                    oracle_card: { name: "Lightning Bolt" },
                    set: { code: "2X2" },
                  },
                },
              },
            ],
            error: null,
          });
        }
        if (table === "published_prices") {
          return inChain({
            data: [{ sellable_sku_id: "sku-1", final_amount: 12.5, currency: "AUD" }],
            error: null,
          });
        }
        if (table === "inventory_balances") {
          return inChain({
            data: [{ sellable_sku_id: "sku-1", quantity_available_online: 3 }],
            error: null,
          });
        }
        throw new Error(`unexpected table: ${table}`);
      });
      const { getSavedList } = await import("./manage-saved-list");

      const result = await getSavedList();

      expect(result).toEqual([
        {
          sellableSkuId: "sku-1",
          printingId: "printing-1",
          cardName: "Lightning Bolt",
          setCode: "2X2",
          rarity: "rare",
          conditionCode: "nm",
          finishCode: "nonfoil",
          price: 12.5,
          currency: "AUD",
          availableQuantity: 3,
        },
      ]);
    });

    it("throws when the saved-list fetch itself fails", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "saved_list_lines") {
          return savedListLinesChain({ data: null, error: { message: "boom" } });
        }
        throw new Error(`unexpected table: ${table}`);
      });
      const { getSavedList } = await import("./manage-saved-list");

      await expect(getSavedList()).rejects.toThrow("Failed to fetch saved list");
    });
  });
});
