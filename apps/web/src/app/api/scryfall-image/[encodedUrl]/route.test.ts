import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

function paramsFor(url: string) {
  return { params: Promise.resolve({ encodedUrl: encodeURIComponent(url) }) };
}

describe("GET /api/scryfall-image/[encodedUrl]", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 for an invalid encoded url", async () => {
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ encodedUrl: "not-a-url" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 for a host other than cards.scryfall.io", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost"),
      paramsFor("https://evil.example.com/x.jpg"),
    );

    expect(response.status).toBe(400);
  });

  it("fetches the upstream image with a real User-Agent and streams it back", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("fake-image-bytes", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    global.fetch = mockFetch;
    const { GET } = await import("./route");

    const upstreamUrl = "https://cards.scryfall.io/normal/front/4/9/492c2f9a.jpg";
    const response = await GET(new Request("http://localhost"), paramsFor(upstreamUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
    expect(String(calledUrl)).toBe(upstreamUrl);
    expect(calledOptions.headers["User-Agent"]).toMatch(/ProbableWinner/);
  });

  it("returns 502 when the upstream fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost"),
      paramsFor("https://cards.scryfall.io/normal/front/missing.jpg"),
    );

    expect(response.status).toBe(502);
  });
});
