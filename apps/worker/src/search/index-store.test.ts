import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

const mockFetchSkuSearchRows = vi.fn();
const mockUpload = vi.fn();
const mockDownload = vi.fn();
const mockFrom = vi.fn(() => ({ upload: mockUpload, download: mockDownload }));
const mockCreateClient = vi.fn(() => ({ storage: { from: mockFrom } }));

vi.mock("../jobs/fetch-sku-search-rows.js", () => ({
  fetchSkuSearchRows: (...args: unknown[]) => mockFetchSkuSearchRows(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockCreateClient(),
}));

function fakeRow(skuId: string, overrides: Record<string, unknown> = {}) {
  return {
    skuId,
    printingId: `printing-${skuId}`,
    oracleCardId: "oracle-1",
    name: "Lightning Bolt",
    typeLine: "Instant",
    manaCost: "{R}",
    cmc: 1,
    colorIdentity: ["R"],
    setCode: "2X2",
    setName: "Double Masters 2022",
    collectorNumber: "117",
    rarity: "uncommon",
    artistName: "Christopher Rush",
    imageUrl: null,
    finishCode: "nonfoil",
    conditionCode: "nm",
    languageCode: "en",
    legality: {},
    priceAmount: 1.5,
    priceCurrency: "AUD",
    quantityAvailable: 4,
    quantityInStores: {},
    popularityScore: 0,
    cataloguedAt: 0,
    ...overrides,
  };
}

describe("index-store", () => {
  const sql = {} as Sql;

  beforeEach(() => {
    mockFetchSkuSearchRows.mockReset();
    mockUpload.mockReset().mockResolvedValue({ error: null });
    mockDownload.mockReset();
    mockFrom.mockClear();
    mockCreateClient.mockClear();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("rebuildFullIndex fetches every row, builds the index, and persists a snapshot", async () => {
    mockFetchSkuSearchRows.mockResolvedValue([fakeRow("sku-1"), fakeRow("sku-2")]);

    const { rebuildFullIndex, getIndexStats, search } = await import("./index-store.js");
    const result = await rebuildFullIndex(sql);

    expect(result.documentCount).toBe(2);
    expect(getIndexStats().documentCount).toBe(2);
    expect(mockUpload).toHaveBeenCalledTimes(1);

    const found = search({ q: "Lightning" });
    expect(found.hits.map((h) => h.id)).toEqual(["sku-1", "sku-2"]);
  });

  it("upsertSkuDocument adds a document that wasn't previously indexed", async () => {
    mockFetchSkuSearchRows.mockResolvedValueOnce([]);
    const { rebuildFullIndex, upsertSkuDocument, search } = await import("./index-store.js");
    await rebuildFullIndex(sql);

    mockFetchSkuSearchRows.mockResolvedValueOnce([fakeRow("sku-new")]);
    const added = await upsertSkuDocument(sql, "sku-new");

    expect(added).toBe(true);
    expect(search({ q: "Lightning" }).hits.map((h) => h.id)).toEqual(["sku-new"]);
  });

  it("upsertSkuDocument removes a document that no longer resolves", async () => {
    mockFetchSkuSearchRows.mockResolvedValueOnce([fakeRow("sku-1")]);
    const { rebuildFullIndex, upsertSkuDocument, search } = await import("./index-store.js");
    await rebuildFullIndex(sql);

    mockFetchSkuSearchRows.mockResolvedValueOnce([]);
    const stillActive = await upsertSkuDocument(sql, "sku-1");

    expect(stillActive).toBe(false);
    expect(search({ q: "Lightning" }).totalHits).toBe(0);
  });

  it("patchPopularityScore updates just that field, keeping the rest of the document", async () => {
    mockFetchSkuSearchRows.mockResolvedValueOnce([fakeRow("sku-1", { popularityScore: 1 })]);
    const { rebuildFullIndex, patchPopularityScore, search } = await import("./index-store.js");
    await rebuildFullIndex(sql);

    const patched = patchPopularityScore("sku-1", 77);

    expect(patched).toBe(true);
    const [hit] = search({ q: "Lightning" }).hits;
    expect(hit.popularity_score).toBe(77);
    expect(hit.name).toBe("Lightning Bolt");
  });

  it("patchPopularityScore returns false for an id that isn't indexed", async () => {
    mockFetchSkuSearchRows.mockResolvedValueOnce([]);
    const { rebuildFullIndex, patchPopularityScore } = await import("./index-store.js");
    await rebuildFullIndex(sql);

    expect(patchPopularityScore("does-not-exist", 50)).toBe(false);
  });

  it("loadSnapshotFromStorage returns false and leaves the index untouched on download failure", async () => {
    mockFetchSkuSearchRows.mockResolvedValueOnce([fakeRow("sku-1")]);
    const { rebuildFullIndex, loadSnapshotFromStorage, getIndexStats } =
      await import("./index-store.js");
    await rebuildFullIndex(sql);

    mockDownload.mockResolvedValue({ data: null, error: new Error("not found") });
    const loaded = await loadSnapshotFromStorage();

    expect(loaded).toBe(false);
    expect(getIndexStats().documentCount).toBe(1);
  });

  it("persistSnapshotToStorage swallows an upload error rather than throwing", async () => {
    mockFetchSkuSearchRows.mockResolvedValueOnce([fakeRow("sku-1")]);
    const { rebuildFullIndex } = await import("./index-store.js");
    mockUpload.mockResolvedValue({ error: new Error("bucket unreachable") });

    await expect(rebuildFullIndex(sql)).resolves.toMatchObject({ documentCount: 1 });
  });
});
