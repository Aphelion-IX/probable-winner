import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchIndex,
  serializeSearchIndex,
  type CardSearchDocument,
} from "@probable-winner/search";

const mockDownload = vi.fn();
const mockFrom = vi.fn(() => ({ download: mockDownload }));
const mockCreatePublicSupabaseClient = vi.fn(() => ({ storage: { from: mockFrom } }));

vi.mock("@/server/supabase", () => ({
  createPublicSupabaseClient: () => mockCreatePublicSupabaseClient(),
}));

function fakeDoc(overrides: Partial<CardSearchDocument> = {}): CardSearchDocument {
  return {
    id: "sku-1",
    printing_id: "printing-1",
    oracle_id: "oracle-1",
    name: "Lightning Bolt",
    set_code: "LEA",
    set_name: "Limited Edition Alpha",
    collector_number: "162",
    rarity: "common",
    artist: "Christopher Rush",
    image_url: "",
    colour_identity: ["R"],
    colour_count: 1,
    mana_cost: "{R}",
    cmc: 1,
    type_line: "Instant",
    finish: "nonfoil",
    condition: "nm",
    language: "en",
    layout: "normal",
    legality: {},
    price_amount: 5,
    price_currency: "AUD",
    quantity_available: 3,
    quantity_in_stores: {},
    popularity_score: 10,
    last_updated_at: 0,
    catalogued_at: 0,
    ...overrides,
  };
}

function fakeSnapshotBlob(docs: CardSearchDocument[]): Buffer {
  const json = serializeSearchIndex(buildSearchIndex(docs));
  return gzipSync(Buffer.from(json, "utf-8"));
}

function mockDownloadOnce(compressed: Buffer) {
  const arrayBuffer = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
  mockDownload.mockResolvedValue({
    data: { arrayBuffer: () => Promise.resolve(arrayBuffer) },
    error: null,
  });
}

describe("search-index-cache", () => {
  beforeEach(() => {
    vi.resetModules();
    mockDownload.mockReset();
    mockFrom.mockClear();
    mockCreatePublicSupabaseClient.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("downloads and decompresses the snapshot on a cold start", async () => {
    mockDownloadOnce(fakeSnapshotBlob([fakeDoc()]));

    const { queryLocalSearchIndex } = await import("./search-index-cache");
    const result = await queryLocalSearchIndex({ q: "Lightning" });

    expect(mockFrom).toHaveBeenCalledWith("search-index");
    expect(mockDownload).toHaveBeenCalledWith("snapshot.json.gz");
    expect(result.hits.map((h) => h.id)).toEqual(["sku-1"]);
  });

  it("serves from cache without re-downloading within the refresh window", async () => {
    mockDownloadOnce(fakeSnapshotBlob([fakeDoc()]));

    const { queryLocalSearchIndex } = await import("./search-index-cache");
    await queryLocalSearchIndex({ q: "Lightning" });
    await queryLocalSearchIndex({ q: "Lightning" });
    await queryLocalSearchIndex({ q: "Lightning" });

    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it("throws on a cold start when the download fails and nothing is cached yet", async () => {
    mockDownload.mockResolvedValue({ data: null, error: new Error("bucket unreachable") });

    const { queryLocalSearchIndex } = await import("./search-index-cache");

    await expect(queryLocalSearchIndex({})).rejects.toThrow();
  });

  it("keeps serving the stale cache if a background refresh fails", async () => {
    vi.useFakeTimers();
    mockDownloadOnce(fakeSnapshotBlob([fakeDoc()]));

    const { queryLocalSearchIndex } = await import("./search-index-cache");
    const first = await queryLocalSearchIndex({ q: "Lightning" });
    expect(first.hits).toHaveLength(1);

    // Past the refresh window: the next call should trigger a background
    // reload attempt, but still return the (stale) cached result rather
    // than blocking on -- or failing because of -- that reload.
    vi.advanceTimersByTime(61_000);
    mockDownload.mockResolvedValue({ data: null, error: new Error("transient failure") });

    const second = await queryLocalSearchIndex({ q: "Lightning" });
    expect(second.hits).toHaveLength(1);
  });
});
