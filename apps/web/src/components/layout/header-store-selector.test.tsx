import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderStoreSelector } from "./header-store-selector";

const mockSelectPreferredStore = vi.fn();

vi.mock("@/app/actions/select-store", () => ({
  selectPreferredStore: (...args: unknown[]) => mockSelectPreferredStore(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const STORES = [
  { id: "store-1", name: "Geelong", code: "STR-01", region: "VIC" },
  { id: "store-2", name: "Bendigo", code: "STR-02", region: "VIC" },
];

function stubFetch(selectedStoreId: string | null = null, stores: typeof STORES = STORES) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/stores/selected") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ storeId: selectedStoreId }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(stores) });
    }),
  );
}

describe("HeaderStoreSelector", () => {
  beforeEach(() => {
    mockSelectPreferredStore.mockReset();
    mockSelectPreferredStore.mockResolvedValue({ success: true });
    stubFetch();
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

  it("preselects the customer's actual saved store, not just the first in the list", async () => {
    stubFetch("store-2");
    render(<HeaderStoreSelector />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Store: Bendigo" })).toBeInTheDocument(),
    );
  });

  it("falls back to the first store when there is no saved selection", async () => {
    stubFetch(null);
    render(<HeaderStoreSelector />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Store: Geelong" })).toBeInTheDocument(),
    );
  });

  it("selects a store, persists it via selectPreferredStore(), and closes the dropdown", async () => {
    render(<HeaderStoreSelector />);

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Bendigo/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Bendigo/));

    expect(screen.queryByText(/Bendigo/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Store: Bendigo" })).toBeInTheDocument();
    await waitFor(() => expect(mockSelectPreferredStore).toHaveBeenCalledWith("store-2"));
  });

  it("shows a fallback message when there are no stores", async () => {
    stubFetch(null, []);
    render(<HeaderStoreSelector />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("No stores available.")).toBeInTheDocument());
  });
});
