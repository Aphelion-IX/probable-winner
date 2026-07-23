import { describe, it, expect } from 'vitest';
import { calculatePopularityScore } from '../calculate-popularity-score.js';

describe('calculatePopularityScore', () => {
  it('should return 0 for no activity', () => {
    const score = calculatePopularityScore({
      total_orders: 0,
      total_quantity_sold: 0,
      inventory_depth: 0,
      availability_stores: 0,
      days_since_last_sale: 30,
    });
    expect(score).toBe(0);
  });

  it('should return max 100 for high activity', () => {
    const score = calculatePopularityScore({
      total_orders: 500,
      total_quantity_sold: 2500,
      inventory_depth: 250,
      availability_stores: 10,
      days_since_last_sale: 0,
    });
    expect(score).toBe(100);
  });

  it('should factor in recent sales heavily', () => {
    const recentSale = calculatePopularityScore({
      total_orders: 10,
      total_quantity_sold: 10,
      inventory_depth: 10,
      availability_stores: 1,
      days_since_last_sale: 0,
    });

    const oldSale = calculatePopularityScore({
      total_orders: 10,
      total_quantity_sold: 10,
      inventory_depth: 10,
      availability_stores: 1,
      days_since_last_sale: 30,
    });

    expect(recentSale).toBeGreaterThan(oldSale);
  });

  it('should scale factors proportionally', () => {
    const highInventory = calculatePopularityScore({
      total_orders: 50,
      total_quantity_sold: 250,
      inventory_depth: 100,
      availability_stores: 5,
      days_since_last_sale: 10,
    });

    const lowInventory = calculatePopularityScore({
      total_orders: 50,
      total_quantity_sold: 250,
      inventory_depth: 25,
      availability_stores: 5,
      days_since_last_sale: 10,
    });

    expect(highInventory).toBeGreaterThan(lowInventory);
  });
});
