import { describe, expect, it } from "vitest";

import {
  cardIdentityCacheKey,
  cardIdentityCacheTag,
  pickImageUrl,
  THUMBNAIL_IMAGE_TYPE_PREFERENCE,
} from "./get-card-identity";

describe("cardIdentityCacheKey", () => {
  it("derives a stable key scoped to the printing id", () => {
    expect(cardIdentityCacheKey("11111111-1111-1111-1111-111111111111")).toEqual([
      "card-identity",
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("produces different keys for different printings", () => {
    expect(cardIdentityCacheKey("printing-a")).not.toEqual(cardIdentityCacheKey("printing-b"));
  });
});

describe("cardIdentityCacheTag", () => {
  it("derives a tag namespaced to the printing id", () => {
    expect(cardIdentityCacheTag("printing-a")).toBe("card-identity:printing-a");
  });
});

describe("pickImageUrl", () => {
  it("prefers the 'normal' image type", () => {
    expect(
      pickImageUrl([
        { imageType: "small", url: "small.png" },
        { imageType: "normal", url: "normal.png" },
        { imageType: "large", url: "large.png" },
      ]),
    ).toBe("normal.png");
  });

  it("falls back to 'large' when 'normal' is missing", () => {
    expect(
      pickImageUrl([
        { imageType: "small", url: "small.png" },
        { imageType: "large", url: "large.png" },
      ]),
    ).toBe("large.png");
  });

  it("falls back to the first available image when no preferred type matches", () => {
    expect(pickImageUrl([{ imageType: "art_crop", url: "art.png" }])).toBe("art.png");
  });

  it("returns null when there are no images", () => {
    expect(pickImageUrl([])).toBeNull();
  });

  it("accepts a custom preference order, e.g. for list thumbnails", () => {
    expect(
      pickImageUrl(
        [
          { imageType: "normal", url: "normal.png" },
          { imageType: "small", url: "small.png" },
        ],
        THUMBNAIL_IMAGE_TYPE_PREFERENCE,
      ),
    ).toBe("small.png");
  });
});
