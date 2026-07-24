import { describe, expect, it } from "vitest";

import { mapStoreRow } from "./list-click-and-collect-stores";

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
