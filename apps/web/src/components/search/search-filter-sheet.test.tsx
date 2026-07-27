import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchFilterSheet } from "./search-filter-sheet";
import { countActiveSearchFilters } from "./search-filters";

const mockPush = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => currentSearchParams,
}));

describe("countActiveSearchFilters", () => {
  it("returns 0 for no filters", () => {
    expect(countActiveSearchFilters(new URLSearchParams())).toBe(0);
  });

  it("counts each single-select filter once", () => {
    const params = new URLSearchParams("rarity=rare&condition=nm&finish=foil");
    expect(countActiveSearchFilters(params)).toBe(3);
  });

  it("counts every selected colour independently", () => {
    const params = new URLSearchParams("colour=W&colour=U&colour=B");
    expect(countActiveSearchFilters(params)).toBe(3);
  });

  it("counts minPrice and maxPrice independently", () => {
    expect(countActiveSearchFilters(new URLSearchParams("minPrice=10"))).toBe(1);
    expect(countActiveSearchFilters(new URLSearchParams("minPrice=10&maxPrice=50"))).toBe(2);
  });
});

describe("SearchFilterSheet", () => {
  afterEach(() => {
    cleanup();
    mockPush.mockReset();
    currentSearchParams = new URLSearchParams();
  });

  it("renders only for mobile viewports (md:hidden wrapper) with no active-count badge by default", () => {
    const { container } = render(<SearchFilterSheet />);

    expect(container.firstChild).toHaveClass("md:hidden");
    expect(screen.getByRole("button", { name: /Filters/ })).toBeInTheDocument();
  });

  it("shows the active-filter count as a badge on the trigger", () => {
    currentSearchParams = new URLSearchParams("rarity=rare&colour=W&colour=U");
    render(<SearchFilterSheet />);

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("opens the sheet with the full filter controls on trigger click", async () => {
    render(<SearchFilterSheet />);

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    await waitFor(() => expect(screen.getByText("Price Range")).toBeInTheDocument());
    expect(screen.getByText("Rarity")).toBeInTheDocument();
  });
});
