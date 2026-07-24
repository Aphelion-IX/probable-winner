import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCardsByScryfallIds,
  SCRYFALL_COLLECTION_BATCH_LIMIT,
  ScryfallValidationError,
} from "./client.js";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCardsByScryfallIds", () => {
  it("returns an empty result without making a request for an empty list", async () => {
    const fetchMock = mockFetchOnce({ object: "list", not_found: [], data: [] });

    const result = await fetchCardsByScryfallIds([]);

    expect(result).toEqual({ object: "list", not_found: [], data: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs identifiers to the collection endpoint and returns the parsed response", async () => {
    const fetchMock = mockFetchOnce({
      object: "list",
      not_found: [],
      data: [{ id: "scry-1", name: "Lightning Bolt" }],
    });

    const result = await fetchCardsByScryfallIds(["scry-1"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.scryfall.com/cards/collection",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ identifiers: [{ id: "scry-1" }] }),
      }),
    );
    expect(result.data).toHaveLength(1);
  });

  it("rejects more identifiers than the documented batch limit without making a request", async () => {
    const fetchMock = mockFetchOnce({ object: "list", not_found: [], data: [] });
    const tooMany = Array.from(
      { length: SCRYFALL_COLLECTION_BATCH_LIMIT + 1 },
      (_, i) => `scry-${i}`,
    );

    await expect(fetchCardsByScryfallIds(tooMany)).rejects.toBeInstanceOf(ScryfallValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-OK HTTP response", async () => {
    mockFetchOnce({}, false, 500);

    await expect(fetchCardsByScryfallIds(["scry-1"])).rejects.toBeInstanceOf(
      ScryfallValidationError,
    );
  });

  it("rejects a malformed response body", async () => {
    mockFetchOnce({ object: "error" });

    await expect(fetchCardsByScryfallIds(["scry-1"])).rejects.toBeInstanceOf(
      ScryfallValidationError,
    );
  });
});
