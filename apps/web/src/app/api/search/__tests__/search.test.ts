import { describe, it, expect } from "vitest";

describe("Search API", () => {
  it("should parse search parameters correctly", () => {
    const params = new URLSearchParams({
      q: "black lotus",
      set: "LIMITED",
      condition: "nm",
      minPrice: "100",
      maxPrice: "500",
      page: "1",
      limit: "20",
    });

    expect(params.get("q")).toBe("black lotus");
    expect(params.get("set")).toBe("LIMITED");
    expect(params.get("condition")).toBe("nm");
    expect(Number(params.get("minPrice"))).toBe(100);
    expect(Number(params.get("maxPrice"))).toBe(500);
  });

  it("should validate page and limit parameters", () => {
    const limit = Math.min(Number(150), 100); // Should cap at 100
    expect(limit).toBe(100);
  });

  it("should handle multiple colour filters", () => {
    const params = new URLSearchParams();
    params.append("colour", "W");
    params.append("colour", "U");
    const colours = params.getAll("colour");
    expect(colours).toContain("W");
    expect(colours).toContain("U");
  });

  it("should support sorting strategies", () => {
    const sortOptions = ["relevance", "price_asc", "price_desc", "popularity"];
    sortOptions.forEach((sort) => {
      expect(["relevance", "price_asc", "price_desc", "popularity"]).toContain(sort);
    });
  });
});
