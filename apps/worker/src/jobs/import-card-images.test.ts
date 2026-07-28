import { describe, expect, it } from "vitest";

import { buildImageRows, buildLegalityRows, chunk } from "./import-card-images.js";
import type { ScryfallCard } from "../integrations/scryfall/types.js";

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when the array is smaller than the chunk size", () => {
    expect(chunk([1, 2], 75)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 75)).toEqual([]);
  });
});

describe("buildImageRows", () => {
  it("maps a single-faced card's top-level image_uris to front-face rows", () => {
    const card: ScryfallCard = {
      id: "scry-1",
      name: "Lightning Bolt",
      image_uris: {
        small: "https://img.scryfall.com/small.jpg",
        normal: "https://img.scryfall.com/normal.jpg",
        large: "https://img.scryfall.com/large.jpg",
        png: "https://img.scryfall.com/card.png",
        art_crop: "https://img.scryfall.com/art.jpg",
        border_crop: "https://img.scryfall.com/border.jpg",
      },
    };

    const rows = buildImageRows("printing-1", card);

    expect(rows).toHaveLength(6);
    expect(rows).toContainEqual({
      cardPrintingId: "printing-1",
      imageType: "normal",
      face: "front",
      url: "https://img.scryfall.com/normal.jpg",
    });
    expect(rows.every((row) => row.face === "front")).toBe(true);
  });

  it("only maps image types that are actually present", () => {
    const card: ScryfallCard = {
      id: "scry-1",
      name: "Lightning Bolt",
      image_uris: { normal: "https://img.scryfall.com/normal.jpg" },
    };

    expect(buildImageRows("printing-1", card)).toEqual([
      {
        cardPrintingId: "printing-1",
        imageType: "normal",
        face: "front",
        url: "https://img.scryfall.com/normal.jpg",
      },
    ]);
  });

  it("maps a double-faced card's per-face image_uris to front and back rows", () => {
    const card: ScryfallCard = {
      id: "scry-2",
      name: "Delver of Secrets // Insectile Aberration",
      card_faces: [
        {
          name: "Delver of Secrets",
          image_uris: { normal: "https://img.scryfall.com/front-normal.jpg" },
        },
        {
          name: "Insectile Aberration",
          image_uris: { normal: "https://img.scryfall.com/back-normal.jpg" },
        },
      ],
    };

    const rows = buildImageRows("printing-2", card);

    expect(rows).toEqual([
      {
        cardPrintingId: "printing-2",
        imageType: "normal",
        face: "front",
        url: "https://img.scryfall.com/front-normal.jpg",
      },
      {
        cardPrintingId: "printing-2",
        imageType: "normal",
        face: "back",
        url: "https://img.scryfall.com/back-normal.jpg",
      },
    ]);
  });

  it("returns no rows when a card has neither image_uris nor card_faces", () => {
    const card: ScryfallCard = { id: "scry-3", name: "Weird Card" };

    expect(buildImageRows("printing-3", card)).toEqual([]);
  });
});

describe("buildLegalityRows", () => {
  const formatIdByCode = new Map([
    ["standard", "format-standard"],
    ["modern", "format-modern"],
    ["commander", "format-commander"],
  ]);

  it("maps only the format codes this app tracks, in formatIdByCode order", () => {
    const card: ScryfallCard = {
      id: "scry-1",
      name: "Lightning Bolt",
      legalities: {
        standard: "not_legal",
        modern: "legal",
        commander: "legal",
        // Scryfall tracks formats this app has no formats row for -- these
        // must not produce a row with an undefined/garbage format_id.
        alchemy: "legal",
        historic: "not_legal",
      },
    };

    expect(buildLegalityRows("oracle-1", card, formatIdByCode)).toEqual([
      { oracleCardId: "oracle-1", formatId: "format-standard", status: "not_legal" },
      { oracleCardId: "oracle-1", formatId: "format-modern", status: "legal" },
      { oracleCardId: "oracle-1", formatId: "format-commander", status: "legal" },
    ]);
  });

  it("skips a format this app tracks that Scryfall's response omits", () => {
    const card: ScryfallCard = {
      id: "scry-1",
      name: "Lightning Bolt",
      legalities: { standard: "legal" },
    };

    expect(buildLegalityRows("oracle-1", card, formatIdByCode)).toEqual([
      { oracleCardId: "oracle-1", formatId: "format-standard", status: "legal" },
    ]);
  });

  it("skips a status this schema's check constraint doesn't recognise", () => {
    const card: ScryfallCard = {
      id: "scry-1",
      name: "Lightning Bolt",
      legalities: { standard: "some_future_status_scryfall_might_add" },
    };

    expect(buildLegalityRows("oracle-1", card, formatIdByCode)).toEqual([]);
  });

  it("returns no rows when a card has no legalities field", () => {
    const card: ScryfallCard = { id: "scry-1", name: "Weird Card" };

    expect(buildLegalityRows("oracle-1", card, formatIdByCode)).toEqual([]);
  });
});
