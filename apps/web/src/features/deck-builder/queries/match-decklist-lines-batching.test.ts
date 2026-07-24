import { describe, expect, it, vi } from "vitest";

// B-181's core AC: a 100-line decklist must resolve via a flat, small number
// of queries, never one per line (blueprint §20's "one database request per
// search result" prohibition). This file is deliberately kept separate from
// match-decklist-lines.test.ts, which statically imports the module under
// test — mocking @/server/supabase only works reliably here because nothing
// in this file imports match-decklist-lines.ts before the mock is set up.
const mockIn = vi.fn().mockReturnValue({
  returns: () => Promise.resolve({ data: [], error: null }),
});
const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

describe("matchDecklistLines — batched query behaviour", () => {
  it("issues exactly one query regardless of how many lines are in the list", async () => {
    const { matchDecklistLines } = await import("./match-decklist-lines");
    const { parseDecklistLine } = await import("@/features/deck-builder/lib/parse-decklist");

    const tenLines = Array.from({ length: 10 }, (_, i) => parseDecklistLine(`1 Card ${i}`)!);
    const hundredLines = Array.from({ length: 100 }, (_, i) => parseDecklistLine(`1 Card ${i}`)!);

    await matchDecklistLines(tenLines);
    await matchDecklistLines(hundredLines);

    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(mockFrom).toHaveBeenCalledWith("card_browse");
    // One `.in()` call per matchDecklistLines invocation, not one per line —
    // this is the assertion that actually stays flat as the list grows.
    expect(mockIn).toHaveBeenCalledTimes(2);
  });

  it("skips the query entirely for an empty list", async () => {
    mockFrom.mockClear();
    const { matchDecklistLines } = await import("./match-decklist-lines");

    const result = await matchDecklistLines([]);

    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
