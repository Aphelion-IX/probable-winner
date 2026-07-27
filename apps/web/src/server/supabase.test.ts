import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockCreateClient = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

describe("createPublicSupabaseClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockCreateClient.mockReset();
    mockCreateClient.mockReturnValue({ from: vi.fn() });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("builds a plain, cookie-free client from the public env vars", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const { createPublicSupabaseClient } = await import("./supabase");

    createPublicSupabaseClient();

    expect(mockCreateClient).toHaveBeenCalledWith("https://example.supabase.co", "anon-key");
  });

  it("throws when the public Supabase env vars are not set", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createPublicSupabaseClient } = await import("./supabase");

    expect(() => createPublicSupabaseClient()).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  });
});
