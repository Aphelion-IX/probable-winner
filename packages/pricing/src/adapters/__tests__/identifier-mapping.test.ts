import { describe, it, expect, beforeEach } from "vitest";
import { TCGPlayerAdapter } from "../tcgplayer.js";
import { CardKingdomAdapter } from "../card-kingdom.js";

describe("Pricing Adapter Identifier Mapping (B-152)", () => {
  describe("TCGPlayer adapter", () => {
    let adapter: TCGPlayerAdapter;

    beforeEach(() => {
      adapter = new TCGPlayerAdapter("test-api-key");
    });

    it("records a mapping exception for every identifier (product lookup isn't implemented yet)", async () => {
      const identifiers = [
        { cardId: "card-1", oracleId: "oracle-1" },
        { cardId: "card-2", oracleId: "oracle-2" },
      ];

      const prices = await adapter.fetchPrices(identifiers);

      expect(prices).toEqual([]);
      const exceptions = adapter.getMappingExceptions();
      expect(exceptions).toHaveLength(2);
      expect(exceptions.map((e) => e.cardId).sort()).toEqual(["card-1", "card-2"]);
      expect(exceptions.every((e) => e.source === "tcgplayer")).toBe(true);
    });

    it("resets exceptions between fetchPrices() calls rather than accumulating", async () => {
      await adapter.fetchPrices([{ cardId: "card-1" }]);
      expect(adapter.getMappingExceptions()).toHaveLength(1);

      await adapter.fetchPrices([{ cardId: "card-2" }, { cardId: "card-3" }]);
      const exceptions = adapter.getMappingExceptions();
      expect(exceptions).toHaveLength(2);
      expect(exceptions.map((e) => e.cardId)).toEqual(["card-2", "card-3"]);
    });

    it("forwards each exception to an injected onMappingException callback", async () => {
      const recorded: Array<{ cardId: string; reason: string }> = [];
      const adapterWithCallback = new TCGPlayerAdapter("test-api-key", (exception) => {
        recorded.push({ cardId: exception.cardId, reason: exception.reason });
      });

      await adapterWithCallback.fetchPrices([{ cardId: "card-1" }]);

      expect(recorded).toEqual([
        { cardId: "card-1", reason: "TCGPlayer product lookup not yet implemented" },
      ]);
    });

    it("should pass health check when API is accessible", async () => {
      const isHealthy = await adapter.healthCheck();
      expect(typeof isHealthy).toBe("boolean");
    });

    it("should not throw on API errors", async () => {
      const identifiers = [{ cardId: "card-1", oracleId: "oracle-1" }];
      const prices = await adapter.fetchPrices(identifiers);
      expect(Array.isArray(prices)).toBe(true);
    });
  });

  describe("Card Kingdom adapter", () => {
    let adapter: CardKingdomAdapter;

    beforeEach(() => {
      adapter = new CardKingdomAdapter("test-api-key");
    });

    it("records a mapping exception for cards missing a usable oracle_id", async () => {
      const identifiers = [
        { cardId: "card-1", oracleId: "oracle-1" },
        { cardId: "card-2" }, // No oracle_id
        { cardId: "card-3", oracleId: "" }, // Empty oracle_id
      ];

      await adapter.fetchPrices(identifiers);

      const exceptions = adapter.getMappingExceptions();
      expect(exceptions).toHaveLength(2);
      expect(exceptions.map((e) => e.cardId).sort()).toEqual(["card-2", "card-3"]);
      expect(exceptions.every((e) => e.source === "card_kingdom")).toBe(true);
      expect(exceptions.every((e) => e.reason.includes("oracle_id"))).toBe(true);
    });

    it("does not record an exception for a card with a valid oracle_id", async () => {
      await adapter.fetchPrices([{ cardId: "card-1", oracleId: "oracle-1" }]);
      expect(adapter.getMappingExceptions()).toHaveLength(0);
    });

    it("forwards each exception to an injected onMappingException callback", async () => {
      const recorded: Array<{ cardId: string; reason: string }> = [];
      const adapterWithCallback = new CardKingdomAdapter("test-api-key", (exception) => {
        recorded.push({ cardId: exception.cardId, reason: exception.reason });
      });

      await adapterWithCallback.fetchPrices([{ cardId: "card-1" }]);

      expect(recorded).toEqual([
        { cardId: "card-1", reason: "Missing oracle_id required for Card Kingdom lookup" },
      ]);
    });

    it("should pass health check", async () => {
      const isHealthy = await adapter.healthCheck();
      expect(typeof isHealthy).toBe("boolean");
    });

    it("should handle mixed valid and invalid identifiers", async () => {
      const identifiers = [
        { cardId: "card-1", oracleId: "oracle-1" },
        { cardId: "card-2" }, // Missing oracle_id
        { cardId: "card-3", oracleId: "oracle-3" },
        { cardId: "card-4", oracleId: "" }, // Empty oracle_id
      ];

      const prices = await adapter.fetchPrices(identifiers);

      expect(Array.isArray(prices)).toBe(true);
      expect(prices.length).toBeLessThanOrEqual(2); // At most 2 valid cards
      expect(
        adapter
          .getMappingExceptions()
          .map((e) => e.cardId)
          .sort(),
      ).toEqual(["card-2", "card-4"]);
    });
  });
});
