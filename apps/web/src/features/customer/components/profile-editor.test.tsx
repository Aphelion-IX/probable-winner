import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileEditor } from "./profile-editor";
import type { CustomerProfile } from "@/features/customer/actions/manage-profile";
import type { ActiveStore } from "@/features/customer/queries/list-active-stores";

const mockUpdateProfile = vi.fn();

vi.mock("@/features/customer/actions/manage-profile", () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

const PROFILE: CustomerProfile = {
  id: "customer-1",
  displayName: "Alex",
  phone: "0400 000 000",
  preferredFulfilmentNodeId: null,
};

const STORES: ActiveStore[] = [
  { id: "store-1", name: "Geelong", code: "GEE", region: "VIC" },
  { id: "store-2", name: "Bendigo", code: "BEN", region: "VIC" },
];

describe("ProfileEditor", () => {
  afterEach(() => {
    cleanup();
    mockUpdateProfile.mockReset();
  });

  it("pre-fills fields from the current profile", () => {
    render(<ProfileEditor profile={PROFILE} stores={STORES} />);

    expect(screen.getByLabelText("Display name")).toHaveValue("Alex");
    expect(screen.getByLabelText("Phone")).toHaveValue("0400 000 000");
  });

  it("submits the edited fields and shows a saved confirmation", async () => {
    mockUpdateProfile.mockResolvedValue(undefined);

    render(<ProfileEditor profile={PROFILE} stores={STORES} />);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Preferred store"), {
      target: { value: "store-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByTestId("profile-status")).toHaveTextContent("Saved.");
    });
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      displayName: "Sam",
      phone: "0400 000 000",
      preferredFulfilmentNodeId: "store-2",
    });
  });

  it("shows an error message when saving fails", async () => {
    mockUpdateProfile.mockRejectedValue(new Error("Failed to update profile"));

    render(<ProfileEditor profile={PROFILE} stores={STORES} />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByTestId("profile-status")).toHaveTextContent(
        "Couldn't save your changes. Please try again.",
      );
    });
  });
});
