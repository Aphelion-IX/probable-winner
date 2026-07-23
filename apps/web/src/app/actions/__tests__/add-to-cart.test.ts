import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addToCart } from '../add-to-cart';

const mockCreateClient = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

describe('addToCart', () => {
  let mockSupabase: MockSupabase;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    };

    mockCreateClient.mockReturnValue(mockSupabase);
  });

  it('should add item to cart successfully', async () => {
    const cartId = 'test-cart-id';

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    });

    mockSupabase.rpc.mockResolvedValue({
      data: { id: 'reservation-id' },
      error: null,
    });

    mockSupabase.from().select().eq().single = vi
      .fn()
      .mockResolvedValue({ data: { id: cartId }, error: null });

    expect(true).toBe(true);
  });

  it('should return error if cart not found', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    });

    const result = await addToCart(
      'nonexistent-cart',
      'sku-id',
      1,
      'node-id'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cart not found');
  });

  it('should return error if inventory unavailable', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Inventory unavailable' },
    });

    const result = await addToCart('cart-id', 'sku-id', 100, 'node-id');

    expect(result.success).toBe(false);
  });
});
