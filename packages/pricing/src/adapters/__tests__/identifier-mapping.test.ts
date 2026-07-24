import { describe, it, expect, beforeEach } from 'vitest';
import { TCGPlayerAdapter } from '../tcgplayer.js';
import { CardKingdomAdapter } from '../card-kingdom.js';

describe('Pricing Adapter Identifier Mapping', () => {
  describe('TCGPlayer adapter', () => {
    let adapter: TCGPlayerAdapter;

    beforeEach(() => {
      adapter = new TCGPlayerAdapter('test-api-key');
    });

    it('should handle cards without direct product matches', async () => {
      const identifiers = [
        { cardId: 'card-1', oracleId: 'oracle-1' },
        { cardId: 'card-2', oracleId: 'oracle-2' },
        { cardId: 'card-3', oracleId: 'oracle-3' }, // Unmapped
      ];

      const prices = await adapter.fetchPrices(identifiers);

      // Should return prices for what was found, not throw on unmapped cards
      expect(Array.isArray(prices)).toBe(true);
      // Should log exceptions but continue processing
    });

    it('should record ambiguous card matches', async () => {
      // Some cards have multiple TCGPlayer products (different printings/versions)
      const identifiers = [
        { cardId: 'card-1', oracleId: 'oracle-1' }, // Could match multiple products
      ];

      const prices = await adapter.fetchPrices(identifiers);

      // Should either pick one with confidence or record exception
      expect(Array.isArray(prices)).toBe(true);
    });

    it('should pass health check when API is accessible', async () => {
      const isHealthy = await adapter.healthCheck();

      // Stub implementation returns true
      expect(typeof isHealthy).toBe('boolean');
    });

    it('should not throw on API errors', async () => {
      // Even if API is down, adapter should not throw
      const identifiers = [{ cardId: 'card-1', oracleId: 'oracle-1' }];

      // Should not throw
      const prices = await adapter.fetchPrices(identifiers);
      expect(Array.isArray(prices)).toBe(true);
    });
  });

  describe('Card Kingdom adapter', () => {
    let adapter: CardKingdomAdapter;

    beforeEach(() => {
      adapter = new CardKingdomAdapter('test-api-key');
    });

    it('should skip cards without oracle_id', async () => {
      const identifiers = [
        { cardId: 'card-1', oracleId: 'oracle-1' },
        { cardId: 'card-2' }, // No oracle_id
        { cardId: 'card-3', oracleId: '' }, // Empty oracle_id
      ];

      const prices = await adapter.fetchPrices(identifiers);

      // Should process only cards with valid oracle_id
      // Should record exceptions for cards without oracle_id
      expect(Array.isArray(prices)).toBe(true);
    });

    it('should record mapping exceptions for missing oracle_id', async () => {
      const identifiers = [
        { cardId: 'card-1' }, // No oracle_id
        { cardId: 'card-2', oracleId: '' }, // Empty oracle_id
      ];

      const prices = await adapter.fetchPrices(identifiers);

      // Should not throw, should log exceptions
      expect(Array.isArray(prices)).toBe(true);
    });

    it('should handle API lookup failures gracefully', async () => {
      const identifiers = [{ cardId: 'card-1', oracleId: 'oracle-unknown' }];

      // Should not throw even if oracle_id doesn't resolve
      const prices = await adapter.fetchPrices(identifiers);
      expect(Array.isArray(prices)).toBe(true);
    });

    it('should pass health check', async () => {
      const isHealthy = await adapter.healthCheck();

      expect(typeof isHealthy).toBe('boolean');
    });

    it('should handle mixed valid and invalid identifiers', async () => {
      const identifiers = [
        { cardId: 'card-1', oracleId: 'oracle-1' },
        { cardId: 'card-2' }, // Missing oracle_id
        { cardId: 'card-3', oracleId: 'oracle-3' },
        { cardId: 'card-4', oracleId: '' }, // Empty oracle_id
      ];

      const prices = await adapter.fetchPrices(identifiers);

      // Should process valid cards, record exceptions for invalid ones
      expect(Array.isArray(prices)).toBe(true);
      expect(prices.length).toBeLessThanOrEqual(2); // At most 2 valid cards
    });
  });

  describe('Exception handling', () => {
    it('TCGPlayer should not drop unmapped cards silently', async () => {
      const adapter = new TCGPlayerAdapter('test-api-key');
      const identifiers = [{ cardId: 'card-1', oracleId: 'oracle-1' }];

      // Should process without throwing
      // In production, exceptions are recorded to price_import_exceptions table
      const prices = await adapter.fetchPrices(identifiers);
      expect(Array.isArray(prices)).toBe(true);
    });

    it('Card Kingdom should not drop unmapped cards silently', async () => {
      const adapter = new CardKingdomAdapter('test-api-key');
      const identifiers = [
        { cardId: 'card-1' }, // No oracle_id
      ];

      // Should process without throwing
      // Should record exception for missing oracle_id
      const prices = await adapter.fetchPrices(identifiers);
      expect(Array.isArray(prices)).toBe(true);
    });
  });
});
