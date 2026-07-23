import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { toStagingRows } from "./catalogue-import.js";
import type { MtgJsonSet } from "../integrations/mtgjson/types.js";

const fixturePath = fileURLToPath(
  new URL("../../tests/fixtures/mtgjson-arn.json", import.meta.url),
);
const arnSet: MtgJsonSet = JSON.parse(readFileSync(fixturePath, "utf-8")).data;

describe("toStagingRows", () => {
  it("maps a real MTGJSON set fixture to exactly one set row and one row per card", () => {
    const { setRow, cardRows } = toStagingRows(arnSet);

    expect(setRow.externalId).toBe("ARN");
    expect(cardRows).toHaveLength(92);
  });

  it("does not duplicate the cards array inside the staged set row", () => {
    const { setRow } = toStagingRows(arnSet);

    expect(setRow.raw).not.toHaveProperty("cards");
  });

  it("keys each staged card row by its MTGJSON printing uuid", () => {
    const { cardRows } = toStagingRows(arnSet);

    const abuJafar = cardRows.find((row) => row.raw.name === "Abu Ja'far");
    expect(abuJafar?.externalId).toBe(abuJafar?.raw.uuid);
    expect(abuJafar?.externalId).toBe("3dd0bd56-5340-5542-8457-646b9acd58ff");

    const uniqueIds = new Set(cardRows.map((row) => row.externalId));
    expect(uniqueIds.size).toBe(cardRows.length);
  });
});
