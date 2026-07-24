import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSet, fetchSetList, MtgJsonValidationError } from "./client.js";

const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/mtgjson-arn.json", import.meta.url),
);
const arnFixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSet", () => {
  it("parses a real MTGJSON set fixture (Arabian Nights, 92 cards)", async () => {
    mockFetchOnce(arnFixture);

    const set = await fetchSet("ARN");

    expect(set.code).toBe("ARN");
    expect(set.cards).toHaveLength(92);
    expect(set.cards[0]?.identifiers.scryfallOracleId).toBeTruthy();
  });

  it("rejects a non-OK HTTP response before touching staging", async () => {
    mockFetchOnce({}, false, 404);

    await expect(fetchSet("ARN")).rejects.toBeInstanceOf(MtgJsonValidationError);
  });

  it("rejects a response with an empty cards array (truncated/corrupt file)", async () => {
    mockFetchOnce({ data: { ...arnFixture.data, cards: [] } });

    await expect(fetchSet("ARN")).rejects.toBeInstanceOf(MtgJsonValidationError);
  });

  it("rejects a response whose set code doesn't match what was requested", async () => {
    mockFetchOnce(arnFixture);

    await expect(fetchSet("MID")).rejects.toBeInstanceOf(MtgJsonValidationError);
  });
});

describe("fetchSetList", () => {
  it("returns every set entry from a SetList response", async () => {
    mockFetchOnce({
      data: [
        { code: "ARN", name: "Arabian Nights", releaseDate: "1993-12-17", type: "expansion" },
        { code: "MID", name: "Innistrad: Midnight Hunt", releaseDate: "2021-09-24", type: "expansion" },
      ],
    });

    const sets = await fetchSetList();

    expect(sets).toHaveLength(2);
    expect(sets[0]?.code).toBe("ARN");
  });

  it("rejects a non-OK HTTP response", async () => {
    mockFetchOnce({}, false, 500);

    await expect(fetchSetList()).rejects.toBeInstanceOf(MtgJsonValidationError);
  });

  it("rejects a response with an empty data array", async () => {
    mockFetchOnce({ data: [] });

    await expect(fetchSetList()).rejects.toBeInstanceOf(MtgJsonValidationError);
  });
});
