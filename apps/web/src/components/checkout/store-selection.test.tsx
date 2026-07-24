import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreSelection } from "./store-selection";
import type { ClickAndCollectStore } from "@/features/customer/queries/list-click-and-collect-stores";

const STORES: ClickAndCollectStore[] = [
  {
    id: "store-1",
    name: "Geelong",
    code: "STR-01",
    region: "VIC",
    address: {
      line1: "1 Main St",
      line2: null,
      city: "Geelong",
      region: "VIC",
      postalCode: "3220",
      country: "Australia",
    },
  },
  { id: "store-2", name: "Bendigo", code: "STR-02", region: "VIC", address: null },
];

describe("StoreSelection", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a message when no store accepts click-and-collect", () => {
    render(<StoreSelection stores={[]} onSelect={vi.fn()} selectedStore={null} />);

    expect(screen.getByText("No stores currently accept click & collect.")).toBeInTheDocument();
  });

  it("renders each store's real address when available", () => {
    render(<StoreSelection stores={STORES} onSelect={vi.fn()} selectedStore={null} />);

    expect(screen.getByText("Geelong")).toBeInTheDocument();
    expect(screen.getByText(/1 Main St, Geelong VIC 3220/)).toBeInTheDocument();
    expect(screen.getByText("Bendigo")).toBeInTheDocument();
  });

  it("calls onSelect with the store id when clicked", () => {
    const onSelect = vi.fn();
    render(<StoreSelection stores={STORES} onSelect={onSelect} selectedStore={null} />);

    fireEvent.click(screen.getByText("Geelong"));

    expect(onSelect).toHaveBeenCalledWith("store-1");
  });
});
