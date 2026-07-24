import { expect, test } from "@playwright/test";

test.describe("Live SKU data caching contract (B-103)", () => {
  test("the live price/availability endpoint always declares no-store, even for an unknown SKU", async ({
    request,
  }) => {
    // Deliberately hits a nonexistent id: the point of this test is the
    // response's cache header, not its body, and the header must be present
    // on every response from this endpoint — including error responses — so
    // a stock change can never be served from a stale cache entry.
    const response = await request.get("/api/sellable-skus/00000000-0000-0000-0000-000000000000");

    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
