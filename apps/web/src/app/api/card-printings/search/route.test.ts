import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSearchCardPrintings = vi.fn();

vi.mock("@/features/catalogue/queries/search-card-printings", () => ({
  searchCardPrintings: (q: string) => mockSearchCardPrintings(q),
}));

describe("GET /api/card-printings/search", () => {
  beforeEach(() => {
    mockSearchCardPrintings.mockReset();
  });

  it("passes the q param through and returns the results", async () => {
    mockSearchCardPrintings.mockResolvedValue([
      { printingId: "printing-1", name: "Lightning Bolt", setCode: "lea", setName: "Alpha" },
    ]);
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest("http://localhost/api/card-printings/search?q=lightning"),
    );

    expect(mockSearchCardPrintings).toHaveBeenCalledWith("lightning");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { printingId: "printing-1", name: "Lightning Bolt", setCode: "lea", setName: "Alpha" },
    ]);
  });

  it("returns a 500 with an error message when the query fails", async () => {
    mockSearchCardPrintings.mockRejectedValue(new Error("boom"));
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/card-printings/search?q=x"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
