import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderStoreSelector } from "./header-store-selector";

const STORES = [
  { id: "store-1", name: "Geelong", code: "STR-01", region: "VIC" },
  { id: "store-2", name: "Bendigo", code: "STR-02", region: "VIC" },
];

describe("HeaderStoreSelector", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(STORES) })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fetches the real store list and shows it when opened", async () => {
    render(<HeaderStoreSelector />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/Geelong/)).toBeInTheDocument());
    expect(screen.getByText(/Bendigo/)).toBeInTheDocument();
  });

  it("selects a store and closes the dropdown", async () => {
    render(<HeaderStoreSelector />);

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Bendigo/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Bendigo/));

    expect(screen.queryByText(/Bendigo/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Store: Bendigo" })).toBeInTheDocument();
  });

  it("shows a fallback message when there are no stores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
    );
    render(<HeaderStoreSelector />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("No stores available.")).toBeInTheDocument());
  });
});
