import { describe, expect, it, vi, beforeEach } from "vitest";

const mockReturns = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ returns: mockReturns });
const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
const mockIlike = vi.fn().mockReturnValue({ order: mockOrder });
const mockSelect = vi.fn().mockReturnValue({ ilike: mockIlike });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

describe("searchCardPrintings", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockIlike.mockClear();
    mockReturns.mockReset();
  });

  it("returns an empty array without querying for a blank query", async () => {
    const { searchCardPrintings } = await import("./search-card-printings");

    expect(await searchCardPrintings("   ")).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("searches card_browse by name and maps rows to camelCase", async () => {
    mockReturns.mockResolvedValue({
      data: [
        { printing_id: "printing-1", name: "Lightning Bolt", set_code: "lea", set_name: "Alpha" },
      ],
      error: null,
    });
    const { searchCardPrintings } = await import("./search-card-printings");

    const result = await searchCardPrintings("lightning");

    expect(mockFrom).toHaveBeenCalledWith("card_browse");
    expect(mockIlike).toHaveBeenCalledWith("name", "%lightning%");
    expect(result).toEqual([
      { printingId: "printing-1", name: "Lightning Bolt", setCode: "lea", setName: "Alpha" },
    ]);
  });

  it("throws with the database error message on failure", async () => {
    mockReturns.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { searchCardPrintings } = await import("./search-card-printings");

    await expect(searchCardPrintings("lightning")).rejects.toThrow(
      "Failed to search card printings: boom",
    );
  });
});
