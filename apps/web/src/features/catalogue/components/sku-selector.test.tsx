import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkuSelector } from "./sku-selector";
import type { SkuOption } from "@/features/catalogue/queries/list-sku-options";

const OPTIONS: SkuOption[] = [
  {
    skuId: "sku-en-nonfoil-nm",
    languageCode: "en",
    languageName: "English",
    finishCode: "nonfoil",
    finishName: "Nonfoil",
    conditionCode: "nm",
    conditionName: "Near Mint",
    conditionSortOrder: 1,
  },
  {
    skuId: "sku-en-foil-nm",
    languageCode: "en",
    languageName: "English",
    finishCode: "foil",
    finishName: "Foil",
    conditionCode: "nm",
    conditionName: "Near Mint",
    conditionSortOrder: 1,
  },
  {
    skuId: "sku-en-nonfoil-lp",
    languageCode: "en",
    languageName: "English",
    finishCode: "nonfoil",
    finishName: "Nonfoil",
    conditionCode: "lp",
    conditionName: "Lightly Played",
    conditionSortOrder: 2,
  },
];

function mockLiveDataFor(skuId: string) {
  const priceBySkuId: Record<
    string,
    { price: number | null; currency: string; availableQuantity: number }
  > = {
    "sku-en-nonfoil-nm": { price: 12.5, currency: "AUD", availableQuantity: 4 },
    "sku-en-foil-nm": { price: 25, currency: "AUD", availableQuantity: 0 },
    "sku-en-nonfoil-lp": { price: 9, currency: "AUD", availableQuantity: 2 },
  };

  return priceBySkuId[skuId] ?? null;
}

describe("SkuSelector", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL) => {
        const url = input.toString();
        const skuId = url.split("/").pop() ?? "";
        const data = mockLiveDataFor(skuId);

        return Promise.resolve({
          ok: data !== null,
          json: () => Promise.resolve(data),
        } as Response);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fetches and displays live price/availability for the default selection on mount", async () => {
    render(<SkuSelector options={OPTIONS} />);

    expect(fetch).toHaveBeenCalledWith("/api/sellable-skus/sku-en-nonfoil-nm", {
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByText("$12.50")).toBeInTheDocument();
    });
    expect(screen.getByText("4 in stock")).toBeInTheDocument();
  });

  it("updates price and availability when the finish selection changes", async () => {
    render(<SkuSelector options={OPTIONS} />);

    await waitFor(() => expect(screen.getByText("$12.50")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Finish"), { target: { value: "foil" } });

    expect(fetch).toHaveBeenLastCalledWith("/api/sellable-skus/sku-en-foil-nm", {
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByText("$25.00")).toBeInTheDocument();
    });
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });

  it("updates price and availability when the condition selection changes", async () => {
    render(<SkuSelector options={OPTIONS} />);

    await waitFor(() => expect(screen.getByText("$12.50")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "lp" } });

    expect(fetch).toHaveBeenLastCalledWith("/api/sellable-skus/sku-en-nonfoil-lp", {
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByText("$9.00")).toBeInTheDocument();
    });
    expect(screen.getByText("2 in stock")).toBeInTheDocument();
  });

  it("shows an 'unavailable' message instead of crashing when a combination has no matching SKU", async () => {
    const sparseOptions = OPTIONS.filter((option) => option.finishCode !== "foil");
    render(
      <SkuSelector
        options={[
          ...sparseOptions,
          { ...OPTIONS[1], finishCode: "etched", finishName: "Etched Foil" },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByText("$12.50")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Finish"), { target: { value: "etched" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "lp" } });

    expect(screen.getByTestId("sku-unavailable")).toHaveTextContent(
      "This combination isn't available.",
    );
  });

  it("renders a fallback message when there are no SKU options at all", () => {
    render(<SkuSelector options={[]} />);

    expect(screen.getByText("This printing isn't available for sale yet.")).toBeInTheDocument();
  });
});
