import { describe, expect, it, vi, beforeEach } from "vitest";

import { mapStoreRow } from "./list-click-and-collect-stores";

const mockReturns = vi.fn();
const mockOrder = vi.fn().mockReturnValue({ returns: mockReturns });
const mockEqCollect = vi.fn().mockReturnValue({ order: mockOrder });
const mockEqActive = vi.fn().mockReturnValue({ eq: mockEqCollect });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEqActive });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockCreatePublicSupabaseClient = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock("@/server/supabase", () => ({
  createPublicSupabaseClient: (...args: unknown[]) => mockCreatePublicSupabaseClient(...args),
  createServerSupabaseClient: (...args: unknown[]) => mockCreateServerSupabaseClient(...args),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

describe("mapStoreRow", () => {
  it("maps a store with an address to camelCase fields", () => {
    expect(
      mapStoreRow({
        id: "store-1",
        name: "Geelong",
        code: "STR-01",
        region: "VIC",
        store_addresses: [
          {
            line1: "1 Main St",
            line2: "Shop 4",
            city: "Geelong",
            region: "VIC",
            postal_code: "3220",
            country: "Australia",
          },
        ],
      }),
    ).toEqual({
      id: "store-1",
      name: "Geelong",
      code: "STR-01",
      region: "VIC",
      address: {
        line1: "1 Main St",
        line2: "Shop 4",
        city: "Geelong",
        region: "VIC",
        postalCode: "3220",
        country: "Australia",
      },
    });
  });

  it("maps a store with no address row to a null address", () => {
    expect(
      mapStoreRow({
        id: "store-1",
        name: "Geelong",
        code: "STR-01",
        region: "VIC",
        store_addresses: null,
      }),
    ).toEqual({
      id: "store-1",
      name: "Geelong",
      code: "STR-01",
      region: "VIC",
      address: null,
    });
  });

  it("maps an empty store_addresses array to a null address", () => {
    expect(
      mapStoreRow({
        id: "store-1",
        name: "Geelong",
        code: "STR-01",
        region: "VIC",
        store_addresses: [],
      }),
    ).toEqual({
      id: "store-1",
      name: "Geelong",
      code: "STR-01",
      region: "VIC",
      address: null,
    });
  });
});

describe("listClickAndCollectStores", () => {
  beforeEach(() => {
    mockCreatePublicSupabaseClient.mockReset();
    mockCreateServerSupabaseClient.mockReset();
    mockCreatePublicSupabaseClient.mockReturnValue({ from: mockFrom });
    mockReturns.mockResolvedValue({
      data: [{ id: "store-1", name: "Geelong", code: "STR-01", region: "VIC", store_addresses: null }],
      error: null,
    });
  });

  it("uses the cookie-free public client, not the session-aware one", async () => {
    const { listClickAndCollectStores } = await import("./list-click-and-collect-stores");

    const stores = await listClickAndCollectStores();

    expect(stores).toEqual([
      { id: "store-1", name: "Geelong", code: "STR-01", region: "VIC", address: null },
    ]);
    expect(mockCreatePublicSupabaseClient).toHaveBeenCalled();
    expect(mockCreateServerSupabaseClient).not.toHaveBeenCalled();
    expect(mockEqActive).toHaveBeenCalledWith("active", true);
    expect(mockEqCollect).toHaveBeenCalledWith("allows_click_collect", true);
  });

  it("throws with the database error message on failure", async () => {
    mockReturns.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { listClickAndCollectStores } = await import("./list-click-and-collect-stores");

    await expect(listClickAndCollectStores()).rejects.toThrow(
      "Failed to list click-and-collect stores: boom",
    );
  });
});
