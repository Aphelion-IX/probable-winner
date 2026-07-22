import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { mapIdentifiers, mapOracleCard, mapPrinting, mapSet } from "./catalogue-mapping.js";
import type { MtgJsonSet } from "../integrations/mtgjson/types.js";

const fixturePath = fileURLToPath(
  new URL("../../tests/fixtures/mtgjson-arn.json", import.meta.url),
);
const arnSet: MtgJsonSet = JSON.parse(readFileSync(fixturePath, "utf-8")).data;

function findCard(name: string, number: string) {
  const card = arnSet.cards.find((c) => c.name === name && c.number === number);
  if (!card) throw new Error(`fixture card not found: ${name} #${number}`);
  return card;
}

describe("mapSet", () => {
  it("maps the real Arabian Nights set metadata", () => {
    const row = mapSet(arnSet);

    expect(row).toEqual({
      code: "ARN",
      name: "Arabian Nights",
      setType: "expansion",
      releasedAt: "1993-12-17",
      cardCount: arnSet.totalSetSize,
    });
  });
});

describe("mapOracleCard: the Army of Allah ambiguous-oracle-id case", () => {
  // Arabian Nights printed several cards at two different rarities under the
  // same name, distinguished only by collector number (2 vs 2†). Both
  // printings share one Scryfall oracle id — this is the real, non-fixture
  // example the backlog AC (B-042) asks to be tested against.
  const printingA = findCard("Army of Allah", "2");
  const printingB = findCard("Army of Allah", "2†");

  it("produces identical oracle card data for both printings", () => {
    expect(mapOracleCard(printingA)).toEqual(mapOracleCard(printingB));
  });

  it("keys both printings by the same scryfall_oracle_id", () => {
    const oracleId = printingA.identifiers.scryfallOracleId;
    expect(oracleId).toBeTruthy();
    expect(mapOracleCard(printingA).scryfallOracleId).toBe(oracleId);
    expect(mapOracleCard(printingB).scryfallOracleId).toBe(oracleId);
  });

  it("still distinguishes the two printings by collector number", () => {
    expect(mapPrinting(printingA).collectorNumber).toBe("2");
    expect(mapPrinting(printingB).collectorNumber).toBe("2†");
  });

  it("counts 14 ambiguous oracle-id groups across the fixture (78 unique oracle cards from 92 printings)", () => {
    const oracleIds = new Set(arnSet.cards.map((c) => c.identifiers.scryfallOracleId));
    expect(oracleIds.size).toBe(78);
    expect(arnSet.cards.length).toBe(92);
  });
});

describe("mapPrinting", () => {
  it("maps a normal printing's rarity/frame/border fields", () => {
    const abuJafar = findCard("Abu Ja'far", "1");
    const row = mapPrinting(abuJafar);

    expect(row.rarity).toBe("uncommon");
    expect(row.frame).toBe("1993");
    expect(row.borderColor).toBe("black");
    expect(row.isPromo).toBe(false);
  });
});

describe("mapIdentifiers", () => {
  it("maps cross-provider ids and parses numeric strings", () => {
    const abuJafar = findCard("Abu Ja'far", "1");
    const row = mapIdentifiers(abuJafar);

    expect(row.scryfallId).toBe("0e9ad288-d164-44a6-96ec-4185a1587f1a");
    expect(row.mtgjsonUuid).toBe("8f2426c7-7523-56b8-a5a3-19b2c6b437c7");
    expect(row.tcgplayerProductId).toBe(3160);
    expect(row.cardmarketId).toBe(6834);
    expect(row.multiverseIds).toEqual([968]);
  });
});
