import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartBadge } from "./cart-badge";

describe("CartBadge", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 3 }) })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the fetched count", async () => {
    render(<CartBadge />);

    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
  });

  it("renders nothing when the cart is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0 }) })),
    );
    const { container } = render(<CartBadge />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("caps the displayed count at 99+", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 150 }) })),
    );
    render(<CartBadge />);

    await waitFor(() => expect(screen.getByText("99+")).toBeInTheDocument());
  });

  it("renders nothing when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network error"))),
    );
    const { container } = render(<CartBadge />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
