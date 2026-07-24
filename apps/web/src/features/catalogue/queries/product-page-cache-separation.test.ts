import { describe, expect, it, vi, beforeEach } from "vitest";

// B-103's core AC (blueprint §14): the product page's stable shell (identity,
// SKU options) and its volatile section (live price/availability) must be
// fetched through genuinely separate paths, so a stock change can only ever
// affect the volatile response — never bust the cached shell. `unstable_cache`
// is the actual mechanism that draws that line in this codebase (see
// get-card-identity.ts / list-sku-options.ts vs. get-sku-live-data.ts), so
// this asserts, at the code level, which functions route through it and
// which deliberately don't — a regression guard against someone accidentally
// wrapping the live endpoint in caching later, or removing it from the
// stable ones.
const mockUnstableCache = vi.fn((fn: (...args: unknown[]) => unknown) => fn);

vi.mock("next/cache", () => ({
  unstable_cache: mockUnstableCache,
}));

function chainableStub(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    returns: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    from: () => chainableStub({ data: null, error: null }),
  }),
}));

describe("product page cache separation", () => {
  beforeEach(() => {
    mockUnstableCache.mockClear();
  });

  it("routes the card identity (stable shell) fetch through unstable_cache", async () => {
    const { getCardIdentity } = await import("./get-card-identity");

    await getCardIdentity("printing-1");

    expect(mockUnstableCache).toHaveBeenCalledTimes(1);
  });

  it("routes the SKU options (stable shell) fetch through unstable_cache", async () => {
    const { listSkuOptions } = await import("./list-sku-options");

    await listSkuOptions("printing-1");

    expect(mockUnstableCache).toHaveBeenCalledTimes(1);
  });

  it("never routes the live price/availability (volatile) fetch through unstable_cache", async () => {
    const { getSkuLiveData } = await import("./get-sku-live-data");

    await getSkuLiveData("sku-1");

    expect(mockUnstableCache).not.toHaveBeenCalled();
  });
});
