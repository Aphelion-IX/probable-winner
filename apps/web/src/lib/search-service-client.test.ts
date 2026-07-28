import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { querySearchService } from "./search-service-client";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

describe("querySearchService", () => {
  beforeEach(() => {
    process.env.SEARCH_SERVICE_URL = "http://worker.internal:8087";
    process.env.SEARCH_SERVICE_TOKEN = "test-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("throws when SEARCH_SERVICE_URL or SEARCH_SERVICE_TOKEN is missing", async () => {
    delete process.env.SEARCH_SERVICE_URL;

    await expect(querySearchService({})).rejects.toThrow(
      "SEARCH_SERVICE_URL and SEARCH_SERVICE_TOKEN must be set",
    );
  });

  it("sends the auth token header and never caches the request", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: [], page: 1, pageSize: 20, totalHits: 0, totalPages: 1 }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await querySearchService({ q: "bolt" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init).toMatchObject({
      headers: { "x-search-service-token": "test-token" },
      cache: "no-store",
    });
  });

  it("builds the query string from every provided param, including repeated colour values", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: [], page: 1, pageSize: 20, totalHits: 0, totalPages: 1 }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await querySearchService({
      q: "bolt",
      colour: ["R", "U"],
      inStock: true,
      minPrice: 1,
      page: 2,
    });

    const [url] = mockFetch.mock.calls[0];
    const requestedUrl = new URL(url as string);
    expect(requestedUrl.pathname).toBe("/search");
    expect(requestedUrl.searchParams.get("q")).toBe("bolt");
    expect(requestedUrl.searchParams.getAll("colour")).toEqual(["R", "U"]);
    expect(requestedUrl.searchParams.get("inStock")).toBe("true");
    expect(requestedUrl.searchParams.get("minPrice")).toBe("1");
    expect(requestedUrl.searchParams.get("page")).toBe("2");
  });

  it("throws a clear error when the search service responds with a non-OK status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    await expect(querySearchService({})).rejects.toThrow("Search service returned 503");
  });
});
