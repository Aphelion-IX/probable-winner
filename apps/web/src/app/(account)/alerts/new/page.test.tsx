import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreateAlertPage from "./page";

const mockCreatePriceAlert = vi.fn();
const mockCreateRestockAlert = vi.fn();
const mockPush = vi.fn();

vi.mock("@/features/customer/actions/manage-alerts", () => ({
  createPriceAlert: (...args: unknown[]) => mockCreatePriceAlert(...args),
  createRestockAlert: (...args: unknown[]) => mockCreateRestockAlert(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const RESULTS = [
  { printingId: "printing-1", name: "Lightning Bolt", setCode: "lea", setName: "Alpha" },
];

describe("CreateAlertPage", () => {
  beforeEach(() => {
    mockCreatePriceAlert.mockReset();
    mockCreateRestockAlert.mockReset();
    mockPush.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RESULTS) })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("disables submit until a real card printing is selected from search", async () => {
    render(<CreateAlertPage />);

    expect(screen.getByRole("button", { name: "Create Alert" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Card Name"), { target: { value: "lightning" } });

    await waitFor(() => expect(screen.getByText(/Lightning Bolt/)).toBeInTheDocument(), {
      timeout: 1000,
    });
    fireEvent.click(screen.getByText(/Lightning Bolt/));

    expect(screen.getByRole("button", { name: "Create Alert" })).toBeEnabled();
  });

  it("creates a price alert with the selected printing's real id", async () => {
    mockCreatePriceAlert.mockResolvedValue("alert-1");
    render(<CreateAlertPage />);

    fireEvent.change(screen.getByLabelText("Card Name"), { target: { value: "lightning" } });
    await waitFor(() => expect(screen.getByText(/Lightning Bolt/)).toBeInTheDocument(), {
      timeout: 1000,
    });
    fireEvent.click(screen.getByText(/Lightning Bolt/));

    fireEvent.change(screen.getByLabelText("Alert When Price Reaches"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));

    await waitFor(() =>
      expect(mockCreatePriceAlert).toHaveBeenCalledWith("printing-1", "normal", 50, "AUD"),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/alerts"));
  });

  it("shows an error instead of submitting when no card has been selected", async () => {
    render(<CreateAlertPage />);

    fireEvent.change(screen.getByLabelText("Card Name"), { target: { value: "lightning" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create Alert" }).closest("form")!);

    expect(screen.getByText("Select a card from the search results")).toBeInTheDocument();
    expect(mockCreatePriceAlert).not.toHaveBeenCalled();
  });
});
