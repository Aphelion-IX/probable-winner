import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecklistImport } from "./decklist-import";
import type { DecklistImportResult } from "@/features/deck-builder/actions/match-decklist";

const mockImportDecklist = vi.fn();

vi.mock("@/features/deck-builder/actions/match-decklist", () => ({
  importDecklist: (...args: unknown[]) => mockImportDecklist(...args),
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
});
