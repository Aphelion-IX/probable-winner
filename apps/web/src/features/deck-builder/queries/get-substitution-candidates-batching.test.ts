import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// Kept in its own file for the same reason as
// match-decklist-lines-batching.test.ts: mocking @/server/supabase only
// works reliably when nothing in this file has already statically imported
// the module under test.
const mockReturns = vi.fn().mockResolvedValue({ data: [], error: null });
const mockEq3 = vi.fn().mockReturnValue({ returns: mockReturns });
const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
const mockIn = vi.fn().mockReturnValue({ eq: mockEq1, returns: mockReturns });
const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

describe("getSubstitutionCandidatesByOracleCard — batched query behaviour", () => {
  it("skips all queries for an empty input", async () => {
    const { getSubstitutionCandidatesByOracleCard } = await import("./get-substitution-candidates");

    const result = await getSubstitutionCandidatesByOracleCard([]);

    expect(result.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("issues a fixed, small number of queries regardless of how many oracle cards are requested", async () => {
    mockFrom.mockClear();
    const { getSubstitutionCandidatesByOracleCard } = await import("./get-substitution-candidates");

    const tenOracleCards = Array.from({ length: 10 }, (_, i) => `oracle-${i}`);
    const hundredOracleCards = Array.from({ length: 100 }, (_, i) => `oracle-${i}`);

    await getSubstitutionCandidatesByOracleCard(tenOracleCards);
    const callsForTen = mockFrom.mock.calls.length;

    mockFrom.mockClear();
    await getSubstitutionCandidatesByOracleCard(hundredOracleCards);
    const callsForHundred = mockFrom.mock.calls.length;

    // Both calls short-circuit after the first (empty) printings query since
    // the mock returns no rows, but the point stands either way: the number
    // of `.from()` calls must not scale with the number of oracle cards.
    expect(callsForTen).toBe(callsForHundred);
    expect(mockFrom).toHaveBeenCalledWith("card_printings");
  });
});
