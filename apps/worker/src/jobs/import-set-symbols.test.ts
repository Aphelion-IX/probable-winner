import { describe, expect, it } from "vitest";

import { matchSetsByCode } from "./import-set-symbols.js";
import type { ScryfallSet } from "../integrations/scryfall/types.js";

describe("matchSetsByCode", () => {
  it("matches a local set to a Scryfall set by exact code", () => {
    const result = matchSetsByCode(
      [{ id: "local-1", code: "mh2" }],
      [
        {
          id: "scry-1",
          code: "mh2",
          name: "Modern Horizons 2",
          icon_svg_uri: "https://svgs.scryfall.io/sets/mh2.svg",
        },
      ],
    );

    expect(result).toEqual([
      { id: "local-1", scryfallId: "scry-1", iconUrl: "https://svgs.scryfall.io/sets/mh2.svg" },
    ]);
  });

  it("matches case-insensitively", () => {
    const result = matchSetsByCode(
      [{ id: "local-1", code: "MH2" }],
      [
        {
          id: "scry-1",
          code: "mh2",
          name: "Modern Horizons 2",
          icon_svg_uri: "https://svgs.scryfall.io/sets/mh2.svg",
        },
      ],
    );

    expect(result).toEqual([
      { id: "local-1", scryfallId: "scry-1", iconUrl: "https://svgs.scryfall.io/sets/mh2.svg" },
    ]);
  });

  it("excludes a local set with no matching Scryfall code, without throwing", () => {
    const result = matchSetsByCode(
      [{ id: "local-1", code: "zzz-not-real" }],
      [
        {
          id: "scry-1",
          code: "mh2",
          name: "Modern Horizons 2",
          icon_svg_uri: "https://svgs.scryfall.io/sets/mh2.svg",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("skips a matched code whose Scryfall entry has no icon_svg_uri", () => {
    const result = matchSetsByCode(
      [{ id: "local-1", code: "mh2" }],
      [{ id: "scry-1", code: "mh2", name: "Modern Horizons 2" }],
    );

    expect(result).toEqual([]);
  });

  it("returns an empty array for empty inputs", () => {
    expect(matchSetsByCode([], [])).toEqual([]);
  });

  it("processes multiple local sets independently", () => {
    const scryfallSets: ScryfallSet[] = [
      {
        id: "scry-1",
        code: "mh2",
        name: "Modern Horizons 2",
        icon_svg_uri: "https://svgs.scryfall.io/sets/mh2.svg",
      },
      {
        id: "scry-2",
        code: "aer",
        name: "Aether Revolt",
        icon_svg_uri: "https://svgs.scryfall.io/sets/aer.svg",
      },
    ];

    const result = matchSetsByCode(
      [
        { id: "local-1", code: "mh2" },
        { id: "local-2", code: "aer" },
        { id: "local-3", code: "unknown" },
      ],
      scryfallSets,
    );

    expect(result).toEqual([
      { id: "local-1", scryfallId: "scry-1", iconUrl: "https://svgs.scryfall.io/sets/mh2.svg" },
      { id: "local-2", scryfallId: "scry-2", iconUrl: "https://svgs.scryfall.io/sets/aer.svg" },
    ]);
  });
});
