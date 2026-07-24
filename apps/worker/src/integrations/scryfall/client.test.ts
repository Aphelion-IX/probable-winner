import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchBulkDataCatalog,
  fetchCardsByScryfallIds,
  findBulkDataEntry,
  SCRYFALL_COLLECTION_BATCH_LIMIT,
  streamBulkDataCards,
  ScryfallValidationError,
} from "./client.js";
import type { ScryfallBulkDataEntry, ScryfallCard } from "./types.js";

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

const BULK_CATALOG: ScryfallBulkDataEntry[] = [
  {
    id: "bulk-1",
    type: "oracle_cards",
    name: "Oracle Cards",
    download_uri: "https://data.scryfall.io/oracle-cards/oracle-cards.json",
    updated_at: "2026-07-24T09:04:00Z",
    size: 1,
  },
  {
    id: "bulk-2",
    type: "default_cards",
    name: "Default Cards",
    download_uri: "https://data.scryfall.io/default-cards/default-cards.json",
    jsonl_download_uri: "https://data.scryfall.io/default-cards/default-cards.jsonl.gz",
    updated_at: "2026-07-24T09:10:00Z",
    size: 2,
  },
];

describe("fetchBulkDataCatalog", () => {
  it("returns the bulk-data entries", async () => {
    mockFetchOnce({ object: "list", data: BULK_CATALOG });

    const catalog = await fetchBulkDataCatalog();

    expect(catalog).toEqual(BULK_CATALOG);
  });

  it("rejects a non-OK HTTP response", async () => {
    mockFetchOnce({}, false, 500);

    await expect(fetchBulkDataCatalog()).rejects.toBeInstanceOf(ScryfallValidationError);
  });

  it("rejects a malformed response body", async () => {
    mockFetchOnce({ object: "error" });

    await expect(fetchBulkDataCatalog()).rejects.toBeInstanceOf(ScryfallValidationError);
  });
});

describe("findBulkDataEntry", () => {
  it("finds the entry matching the requested type", () => {
    expect(findBulkDataEntry(BULK_CATALOG, "default_cards")).toEqual(BULK_CATALOG[1]);
  });

  it("returns null when no entry matches", () => {
    expect(findBulkDataEntry(BULK_CATALOG, "all_cards")).toBeNull();
  });
});

describe("streamBulkDataCards", () => {
  it("streams and parses every card from a real gzipped JSONL body", async () => {
    const cards: ScryfallCard[] = [
      { id: "scry-1", name: "Lightning Bolt", image_uris: { normal: "https://x/1.jpg" } },
      { id: "scry-2", name: "Counterspell", image_uris: { normal: "https://x/2.jpg" } },
    ];
    const jsonl = cards.map((card) => JSON.stringify(card)).join("\n") + "\n";
    const gzipped = gzipSync(Buffer.from(jsonl, "utf-8"));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(gzipped, { status: 200 })));

    const seen: ScryfallCard[] = [];
    await streamBulkDataCards("https://data.scryfall.io/default-cards.jsonl.gz", (card) => {
      seen.push(card);
    });

    expect(seen).toEqual(cards);
  });

  it("skips blank lines", async () => {
    const jsonl = `${JSON.stringify({ id: "scry-1", name: "Lightning Bolt" })}\n\n`;
    const gzipped = gzipSync(Buffer.from(jsonl, "utf-8"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(gzipped, { status: 200 })));

    const seen: ScryfallCard[] = [];
    await streamBulkDataCards("https://data.scryfall.io/default-cards.jsonl.gz", (card) => {
      seen.push(card);
    });

    expect(seen).toHaveLength(1);
  });

  it("rejects a non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(
      streamBulkDataCards("https://data.scryfall.io/default-cards.jsonl.gz", () => {}),
    ).rejects.toBeInstanceOf(ScryfallValidationError);
  });
});
