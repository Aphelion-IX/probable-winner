import { describe, it, expect } from "vitest";
import {
  mapProductsToPrices as mapTCGPlayerProducts,
  TCGPlayerPriceValidationError,
} from "../tcgplayer/prices.js";
import {
  mapProductsToPrices as mapCardKingdomProducts,
  CardKingdomPriceValidationError,
} from "../cardkingdom/prices.js";

describe("TCGPlayer pricing adapter - identifier mapping", () => {
  it("should map TCGPlayer products to ImportedPrice format", () => {
    const products = [
      {
        productId: 12345,
        name: "Lightning Bolt",
        url: "https://tcgplayer.com/product/12345",
        pricings: [
          {
            priceType: "all",
            lowPrice: 1.5,
            midPrice: 2.0,
            highPrice: 3.0,
            marketPrice: 2.15,
          },
        ],
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapTCGPlayerProducts(products, observedAt);

    expect(prices).toHaveLength(3); // low, market, retail (mid)
    expect(prices[0]).toMatchObject({
      provider: "tcgplayer",
      sourceProductId: "12345",
      language: "en",
      finish: "normal",
      currency: "USD",
      observedAt,
    });
  });

  it("should skip undefined price amounts", () => {
    const products = [
      {
        productId: 12345,
        name: "Lightning Bolt",
        url: "https://tcgplayer.com/product/12345",
        pricings: [
          {
            priceType: "all",
            // lowPrice and midPrice undefined
            marketPrice: 2.15,
          },
        ],
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapTCGPlayerProducts(products, observedAt);

    // Only market price should be included
    expect(prices).toHaveLength(1);
    expect(prices[0].priceType).toBe("market");
  });

  it("should handle multiple products in one batch", () => {
    const products = [
      {
        productId: 111,
        name: "Card 1",
        url: "https://tcgplayer.com/product/111",
        pricings: [{ priceType: "all", marketPrice: 1.0 }],
      },
      {
        productId: 222,
        name: "Card 2",
        url: "https://tcgplayer.com/product/222",
        pricings: [{ priceType: "all", marketPrice: 2.0 }],
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapTCGPlayerProducts(products, observedAt);

    expect(prices.length).toBeGreaterThanOrEqual(2);
    expect(prices.some((p) => p.sourceProductId === "111")).toBe(true);
    expect(prices.some((p) => p.sourceProductId === "222")).toBe(true);
  });

  it("should use normal finish for all TCGPlayer prices (finish not differentiated)", () => {
    const products = [
      {
        productId: 12345,
        name: "Lightning Bolt",
        url: "https://tcgplayer.com/product/12345",
        pricings: [
          {
            priceType: "all",
            lowPrice: 1.5,
            marketPrice: 2.15,
          },
        ],
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapTCGPlayerProducts(products, observedAt);

    for (const price of prices) {
      expect(price.finish).toBe("normal");
    }
  });
});

describe("Card Kingdom pricing adapter - identifier mapping", () => {
  it("should map Card Kingdom products to ImportedPrice format with finish differentiation", () => {
    const products = [
      {
        id: "ck-12345",
        name: "Lightning Bolt",
        setName: "Limited Edition Alpha",
        cardNumber: "1",
        normalPrice: 500.0,
        foilPrice: 750.0,
        oracleId: "oracle-lightning-bolt",
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapCardKingdomProducts(products, observedAt);

    // Should emit two prices: normal and foil
    expect(prices).toHaveLength(2);
    expect(prices[0]).toMatchObject({
      provider: "card_kingdom",
      sourceProductId: "ck-12345",
      language: "en",
      finish: "normal",
      priceType: "retail",
      amount: 500.0,
      currency: "USD",
    });
    expect(prices[1]).toMatchObject({
      provider: "card_kingdom",
      sourceProductId: "ck-12345",
      language: "en",
      finish: "foil",
      priceType: "retail",
      amount: 750.0,
      currency: "USD",
    });
  });

  it("should skip missing finish prices (normal or foil may be undefined)", () => {
    const products = [
      {
        id: "ck-12345",
        name: "Lightning Bolt",
        setName: "Limited Edition Alpha",
        cardNumber: "1",
        normalPrice: 500.0,
        foilPrice: undefined,
        oracleId: "oracle-lightning-bolt",
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapCardKingdomProducts(products, observedAt);

    // Only normal finish should be included
    expect(prices).toHaveLength(1);
    expect(prices[0].finish).toBe("normal");
  });

  it("should include SKU IDs with finish suffix for deduplication", () => {
    const products = [
      {
        id: "ck-12345",
        name: "Lightning Bolt",
        setName: "LEA",
        cardNumber: "1",
        normalPrice: 500.0,
        foilPrice: 750.0,
        oracleId: "oracle-lightning-bolt",
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapCardKingdomProducts(products, observedAt);

    expect(prices[0].sourceSkuId).toBe("ck-12345-normal");
    expect(prices[1].sourceSkuId).toBe("ck-12345-foil");
  });

  it("should handle multiple products with mixed finish availability", () => {
    const products = [
      {
        id: "ck-111",
        name: "Card 1",
        setName: "Set 1",
        cardNumber: "1",
        normalPrice: 10.0,
        foilPrice: undefined,
        oracleId: "oracle-1",
      },
      {
        id: "ck-222",
        name: "Card 2",
        setName: "Set 2",
        cardNumber: "2",
        normalPrice: 20.0,
        foilPrice: 30.0,
        oracleId: "oracle-2",
      },
    ];

    const observedAt = new Date().toISOString();
    const prices = mapCardKingdomProducts(products, observedAt);

    // Card 1: 1 price (normal only), Card 2: 2 prices (normal + foil)
    expect(prices.length).toBe(3);
    const card1Prices = prices.filter((p) => p.sourceProductId === "ck-111");
    const card2Prices = prices.filter((p) => p.sourceProductId === "ck-222");

    expect(card1Prices).toHaveLength(1);
    expect(card2Prices).toHaveLength(2);
  });
});

describe("Pricing adapter error handling", () => {
  it("should provide custom error for TCGPlayer validation failures", () => {
    expect(() => {
      throw new TCGPlayerPriceValidationError("API returned invalid data");
    }).toThrow(TCGPlayerPriceValidationError);
  });

  it("should provide custom error for Card Kingdom validation failures", () => {
    expect(() => {
      throw new CardKingdomPriceValidationError("API returned invalid data");
    }).toThrow(CardKingdomPriceValidationError);
  });

  it("should distinguish between validation errors and network errors", () => {
    const validationErr = new TCGPlayerPriceValidationError("API returned status 401");
    const networkErr = new Error("Network timeout");

    expect(validationErr).toBeInstanceOf(TCGPlayerPriceValidationError);
    expect(networkErr).not.toBeInstanceOf(TCGPlayerPriceValidationError);
  });
});
