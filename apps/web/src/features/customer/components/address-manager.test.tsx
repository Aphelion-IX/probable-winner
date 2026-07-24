import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddressManager } from "./address-manager";
import type { CustomerAddress } from "@/features/customer/actions/manage-profile";

const mockCreateAddress = vi.fn();
const mockDeleteAddress = vi.fn();

vi.mock("@/features/customer/actions/manage-profile", () => ({
  createAddress: (...args: unknown[]) => mockCreateAddress(...args),
  deleteAddress: (...args: unknown[]) => mockDeleteAddress(...args),
}));

const EXISTING_ADDRESS: CustomerAddress = {
  id: "address-1",
  label: "Home",
  line1: "1 Test Street",
  line2: null,
  city: "Sydney",
  region: "NSW",
  postalCode: "2000",
  country: "AU",
  isDefault: true,
};

describe("AddressManager", () => {
  afterEach(() => {
    cleanup();
    mockCreateAddress.mockReset();
    mockDeleteAddress.mockReset();
  });

  it("renders existing addresses", () => {
    render(<AddressManager initialAddresses={[EXISTING_ADDRESS]} />);

    expect(screen.getByText("1 Test Street")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("adds a new address and appends it to the list", async () => {
    mockCreateAddress.mockResolvedValue("address-2");

    render(<AddressManager initialAddresses={[]} />);

    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "2 New Street" },
    });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Melbourne" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "AU" } });
    fireEvent.click(screen.getByRole("button", { name: /add address/i }));

    await waitFor(() => {
      expect(screen.getByText("2 New Street")).toBeInTheDocument();
    });
    expect(mockCreateAddress).toHaveBeenCalledWith(
      expect.objectContaining({ line1: "2 New Street", city: "Melbourne", country: "AU" }),
    );
  });

  it("removes an address from the list on delete", async () => {
    mockDeleteAddress.mockResolvedValue(undefined);

    render(<AddressManager initialAddresses={[EXISTING_ADDRESS]} />);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(screen.queryByText("1 Test Street")).not.toBeInTheDocument();
    });
    expect(mockDeleteAddress).toHaveBeenCalledWith("address-1");
  });

  it("shows an error message when deleting fails, keeping the address visible", async () => {
    mockDeleteAddress.mockRejectedValue(new Error("Failed to delete address"));

    render(<AddressManager initialAddresses={[EXISTING_ADDRESS]} />);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't remove this address. Please try again."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("1 Test Street")).toBeInTheDocument();
  });
});
