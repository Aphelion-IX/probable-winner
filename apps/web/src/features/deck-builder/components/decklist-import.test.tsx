import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecklistImport } from "./decklist-import";
import type { DecklistImportResult } from "@/features/deck-builder/actions/match-decklist";

const mockImportDecklist = vi.fn();
const mockGetSubstitutions = vi.fn();
const mockAddAllToCart = vi.fn();

vi.mock("@/features/deck-builder/actions/match-decklist", () => ({
  importDecklist: (...args: unknown[]) => mockImportDecklist(...args),
}));

vi.mock("@/features/deck-builder/actions/get-substitutions", () => ({
  getSubstitutions: (...args: unknown[]) => mockGetSubstitutions(...args),
}));

vi.mock("@/features/deck-builder/actions/add-all-to-cart", () => ({
  addAllToCart: (...args: unknown[]) => mockAddAllToCart(...args),
}));

const RESULT: DecklistImportResult = {
  lines: [
    {
      raw: "1 Counterspell",
      quantity: 1,
      name: "Counterspell",
      candidates: [
        {
          printingId: "printing-cs",
          oracleCardId: "oracle-cs",
          name: "Counterspell",
          setCode: "2X2",
          setName: "Double Masters 2022",
          collectorNumber: "94",
        },
      ],
    },
    {
      raw: "4 Lightning Bolt",
      quantity: 4,
      name: "Lightning Bolt",
      candidates: [
        {
          printingId: "printing-bolt-2x2",
          oracleCardId: "oracle-bolt",
          name: "Lightning Bolt",
          setCode: "2X2",
          setName: "Double Masters 2022",
          collectorNumber: "117",
        },
        {
          printingId: "printing-bolt-m11",
          oracleCardId: "oracle-bolt",
          name: "Lightning Bolt",
          setCode: "M11",
          setName: "Magic 2011",
          collectorNumber: "146",
        },
      ],
    },
    {
      raw: "2 Not A Real Card",
      quantity: 2,
      name: "Not A Real Card",
      candidates: [],
    },
  ],
  skippedLines: ["Sideboard:"],
};

async function submit(text: string) {
  fireEvent.change(screen.getByLabelText("Paste your decklist"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /match list/i }));
}

describe("DecklistImport", () => {
  afterEach(() => {
    cleanup();
    mockImportDecklist.mockReset();
    mockGetSubstitutions.mockReset();
    mockAddAllToCart.mockReset();
  });

  it("disables the submit button until something is pasted", () => {
    render(<DecklistImport />);
    expect(screen.getByRole("button", { name: /match list/i })).toBeDisabled();
  });

  it("shows a resolved single-candidate line without requiring a choice", async () => {
    mockImportDecklist.mockResolvedValue(RESULT);
    render(<DecklistImport />);

    await submit("1 Counterspell\n4 Lightning Bolt\n2 Not A Real Card");

    await waitFor(() => {
      expect(screen.getByText("Double Masters 2022 · #94")).toBeInTheDocument();
    });
  });

  it("shows an ambiguous line as radio options and lets the customer pick one", async () => {
    mockImportDecklist.mockResolvedValue(RESULT);
    render(<DecklistImport />);

    await submit("1 Counterspell\n4 Lightning Bolt\n2 Not A Real Card");

    await waitFor(() => {
      expect(screen.getByTestId("ambiguous-line")).toBeInTheDocument();
    });

    const m11Option = screen.getByRole("radio", { name: /Magic 2011 · #146/i });
    expect(m11Option).not.toBeChecked();

    fireEvent.click(m11Option);
    expect(m11Option).toBeChecked();
  });

  it("shows a 'no match found' message for an unresolved line", async () => {
    mockImportDecklist.mockResolvedValue(RESULT);
    render(<DecklistImport />);

    await submit("1 Counterspell\n4 Lightning Bolt\n2 Not A Real Card");

    await waitFor(() => {
      expect(screen.getByText("No match found in the catalogue.")).toBeInTheDocument();
    });
  });

  it("reports the resolved count and skipped-line count", async () => {
    mockImportDecklist.mockResolvedValue(RESULT);
    render(<DecklistImport />);

    await submit("1 Counterspell\n4 Lightning Bolt\n2 Not A Real Card\nSideboard:");

    await waitFor(() => {
      // Counterspell (1 candidate, pre-selected) resolved; Lightning Bolt
      // (2 candidates) not yet resolved until the customer picks one; the
      // unmatched card never resolves.
      expect(screen.getByText(/1 of 3 lines resolved/)).toBeInTheDocument();
      expect(screen.getByText(/1 line skipped/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: /Magic 2011 · #146/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 of 3 lines resolved/)).toBeInTheDocument();
    });
  });

  it("shows an error message when matching fails", async () => {
    mockImportDecklist.mockRejectedValue(new Error("Failed to match decklist lines"));
    render(<DecklistImport />);

    await submit("1 Counterspell");

    await waitFor(() => {
      expect(screen.getByText("Couldn't match this list. Please try again.")).toBeInTheDocument();
    });
  });

  describe("substitution and budget controls", () => {
    async function matchThenCheckPricing() {
      mockImportDecklist.mockResolvedValue(RESULT);
      render(<DecklistImport />);
      await submit("1 Counterspell\n4 Lightning Bolt\n2 Not A Real Card");
      await waitFor(() =>
        expect(screen.getByText("Double Masters 2022 · #94")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: /check pricing/i }));
    }

    it("only requests substitutions for resolved lines, using the customer's selected printing", async () => {
      mockGetSubstitutions.mockResolvedValue([{ status: "unavailable" }]);

      await matchThenCheckPricing();

      await waitFor(() => expect(mockGetSubstitutions).toHaveBeenCalledTimes(1));
      expect(mockGetSubstitutions).toHaveBeenCalledWith(
        [{ oracleCardId: "oracle-cs", preferredPrintingId: "printing-cs" }],
        { preferredConditionCode: "nm", preferredConditionSortOrder: 1, maxBudget: null },
      );
    });

    it("passes the selected condition and parsed budget as preferences", async () => {
      mockGetSubstitutions.mockResolvedValue([{ status: "unavailable" }]);
      mockImportDecklist.mockResolvedValue(RESULT);
      render(<DecklistImport />);
      await submit("1 Counterspell");
      await waitFor(() =>
        expect(screen.getByText("Double Masters 2022 · #94")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText("Preferred condition"), { target: { value: "lp" } });
      fireEvent.change(screen.getByLabelText("Max budget per card"), { target: { value: "15" } });
      fireEvent.click(screen.getByRole("button", { name: /check pricing/i }));

      await waitFor(() =>
        expect(mockGetSubstitutions).toHaveBeenCalledWith(expect.any(Array), {
          preferredConditionCode: "lp",
          preferredConditionSortOrder: 2,
          maxBudget: 15,
        }),
      );
    });

    it("shows the price and location for a 'preferred' outcome", async () => {
      mockGetSubstitutions.mockResolvedValue([
        {
          status: "preferred",
          sku: {
            skuId: "sku-cs-nm",
            printingId: "printing-cs",
            conditionCode: "nm",
            conditionSortOrder: 1,
            price: 12.5,
            availableQuantity: 3,
            setCode: "2X2",
            setName: "Double Masters 2022",
            collectorNumber: "94",
          },
        },
      ]);

      await matchThenCheckPricing();

      await waitFor(() => {
        expect(screen.getByTestId("substitution-note")).toHaveTextContent(
          "$12.50 · Double Masters 2022 #94 · NM",
        );
      });
    });

    it("flags a 'substituted' outcome with its reason", async () => {
      mockGetSubstitutions.mockResolvedValue([
        {
          status: "substituted",
          reason: "printing",
          sku: {
            skuId: "sku-other",
            printingId: "printing-other",
            conditionCode: "lp",
            conditionSortOrder: 2,
            price: 6,
            availableQuantity: 1,
            setCode: "M11",
            setName: "Magic 2011",
            collectorNumber: "50",
          },
        },
      ]);

      await matchThenCheckPricing();

      await waitFor(() => {
        expect(screen.getByTestId("substitution-note")).toHaveTextContent(
          "Substituted (different printing): $6.00 · Magic 2011 #50 · LP",
        );
      });
    });

    it("flags an 'unavailable' outcome distinctly", async () => {
      mockGetSubstitutions.mockResolvedValue([{ status: "unavailable" }]);

      await matchThenCheckPricing();

      await waitFor(() => {
        expect(screen.getByTestId("substitution-note")).toHaveTextContent(
          "Not currently available in stock.",
        );
      });
    });
  });

  describe("fulfilment percentage and add-all-to-cart", () => {
    async function matchThenCheckPricing() {
      mockImportDecklist.mockResolvedValue(RESULT);
      render(<DecklistImport />);
      await submit("1 Counterspell\n4 Lightning Bolt\n2 Not A Real Card");
      await waitFor(() =>
        expect(screen.getByText("Double Masters 2022 · #94")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: /check pricing/i }));
    }

    const COUNTERSPELL_PREFERRED = {
      status: "preferred" as const,
      sku: {
        skuId: "sku-cs-nm",
        printingId: "printing-cs",
        conditionCode: "nm",
        conditionSortOrder: 1,
        price: 12.5,
        availableQuantity: 3,
        setCode: "2X2",
        setName: "Double Masters 2022",
        collectorNumber: "94",
      },
    };

    it("weights the fulfilment percentage by card quantity, only counting checked lines", async () => {
      // Total quantity across all 3 lines is 1 + 4 + 2 = 7; only
      // Counterspell (quantity 1) is resolved and checked, since Lightning
      // Bolt is still ambiguous and the unmatched card never resolves.
      mockGetSubstitutions.mockResolvedValue([COUNTERSPELL_PREFERRED]);

      await matchThenCheckPricing();

      await waitFor(() => {
        expect(screen.getByTestId("fulfilment-percentage")).toHaveTextContent(
          `${Math.round((1 / 7) * 100)}% of this list can be fulfilled right now`,
        );
      });
    });

    it("disables 'Add all to cart' when nothing is fulfillable", async () => {
      mockGetSubstitutions.mockResolvedValue([{ status: "unavailable" }]);

      await matchThenCheckPricing();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /add all to cart/i })).toBeDisabled();
      });
    });

    it("adds exactly the fulfillable lines to the cart, matching the previewed percentage", async () => {
      mockGetSubstitutions.mockResolvedValue([COUNTERSPELL_PREFERRED]);
      mockAddAllToCart.mockResolvedValue({ status: "success", addedCount: 1, failedCount: 0 });

      await matchThenCheckPricing();
      await waitFor(() => expect(screen.getByTestId("fulfilment-percentage")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /add all to cart/i }));

      await waitFor(() => {
        expect(screen.getByTestId("cart-summary")).toHaveTextContent(
          "Added 1 of 1 cards to your cart.",
        );
      });
      // Counterspell's parsed quantity (1) travels through, not some default.
      expect(mockAddAllToCart).toHaveBeenCalledWith([{ skuId: "sku-cs-nm", quantity: 1 }]);
    });

    it("shows an error message when adding to cart fails", async () => {
      mockGetSubstitutions.mockResolvedValue([COUNTERSPELL_PREFERRED]);
      mockAddAllToCart.mockResolvedValue({ status: "error", message: "boom" });

      await matchThenCheckPricing();
      await waitFor(() => expect(screen.getByTestId("fulfilment-percentage")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /add all to cart/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Couldn't add these cards to your cart. Please try again."),
        ).toBeInTheDocument();
      });
    });
  });
});
