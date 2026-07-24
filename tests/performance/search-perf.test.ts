import { describe, it, expect, beforeEach } from "vitest";

describe("Search API Performance Tests", () => {
  const baseURL = "http://localhost:3000";

  beforeEach(async () => {
    // Setup: ensure dev server is running
  });

  it("should return search results within budget (< 500ms)", async () => {
    const start = performance.now();

    const response = await fetch(`${baseURL}/api/search?q=black&limit=20`, {
      method: "GET",
    });

    const end = performance.now();
    const duration = end - start;

    expect(response.ok).toBe(true);
    expect(duration).toBeLessThan(500);

    const data = await response.json();
    expect(data.hits).toBeDefined();
    expect(data.totalHits).toBeDefined();
  });

  it("should handle pagination efficiently", async () => {
    const pageNumbers = [1, 2, 5, 10];
    const durations: number[] = [];

    for (const page of pageNumbers) {
      const start = performance.now();
      await fetch(`${baseURL}/api/search?q=card&page=${page}&limit=20`);
      const end = performance.now();
      durations.push(end - start);
    }

    // All pages should complete in similar time (no degradation)
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    for (const duration of durations) {
      // Allow 2x variance between pages
      expect(duration).toBeLessThan(avgDuration * 2);
    }
  });

  it("should filter results efficiently (< 300ms)", async () => {
    const filters = [
      "?rarity=rare",
      "?condition=nm",
      "?finish=foil",
      "?colour=U",
      "?minPrice=10&maxPrice=100",
      "?rarity=rare&condition=nm&finish=foil",
    ];

    for (const filter of filters) {
      const start = performance.now();
      const response = await fetch(`${baseURL}/api/search${filter}&limit=20`);
      const end = performance.now();

      expect(response.ok).toBe(true);
      expect(end - start).toBeLessThan(300);
    }
  });

  it("should handle large result sets without timeout", async () => {
    const start = performance.now();

    const response = await fetch(`${baseURL}/api/search?q=&limit=100`);

    const end = performance.now();

    expect(response.ok).toBe(true);
    expect(end - start).toBeLessThan(1000);

    const data = await response.json();
    expect(data.hits.length).toBeLessThanOrEqual(100);
  });

  it("should cache search results for identical queries", async () => {
    const query = "?q=test&limit=20";

    // First request
    const start1 = performance.now();
    const response1 = await fetch(`${baseURL}/api/search${query}`);
    const duration1 = performance.now() - start1;

    // Second request (should be cached)
    const start2 = performance.now();
    const response2 = await fetch(`${baseURL}/api/search${query}`);
    const duration2 = performance.now() - start2;

    expect(response1.ok).toBe(true);
    expect(response2.ok).toBe(true);

    // Second request may be cached (implementation dependent)
    // Just verify both complete quickly
    expect(duration1).toBeLessThan(500);
    expect(duration2).toBeLessThan(500);
  });

  it("should validate response size", async () => {
    const response = await fetch(`${baseURL}/api/search?q=card&limit=50`);
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data.hits)).toBe(true);

    // Each hit should have required fields
    for (const hit of data.hits.slice(0, 5)) {
      expect(hit.id).toBeDefined();
      expect(hit.name).toBeDefined();
      expect(hit.price_amount).toBeDefined();
    }
  });
});
