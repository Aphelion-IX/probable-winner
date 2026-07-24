import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RestockAlertButton,
  toRestockAlertCondition,
  toRestockAlertFinish,
} from "./restock-alert-button";

const mockCreateRestockAlert = vi.fn();

vi.mock("@/features/customer/actions/manage-alerts", () => ({
  createRestockAlert: (...args: unknown[]) => mockCreateRestockAlert(...args),
}));

describe("toRestockAlertFinish", () => {
  it("maps the catalogue's 'nonfoil' to the alerts table's 'normal'", () => {
    expect(toRestockAlertFinish("nonfoil")).toBe("normal");
  });

  it("passes other finish codes through unchanged", () => {
    expect(toRestockAlertFinish("foil")).toBe("foil");
    expect(toRestockAlertFinish("etched")).toBe("etched");
  });
});

describe("toRestockAlertCondition", () => {
  it("uppercases the condition code", () => {
    expect(toRestockAlertCondition("nm")).toBe("NM");
    expect(toRestockAlertCondition("dmg")).toBe("DMG");
  });
});

describe("RestockAlertButton", () => {
  afterEach(() => {
    cleanup();
    mockCreateRestockAlert.mockReset();
  });

  it("calls createRestockAlert with the mapped finish/condition vocabulary and shows a success message", async () => {
    mockCreateRestockAlert.mockResolvedValue("alert-1");

    render(<RestockAlertButton printingId="printing-1" finishCode="nonfoil" conditionCode="nm" />);

    fireEvent.click(screen.getByTestId("restock-alert-button"));

    await waitFor(() => {
      expect(screen.getByTestId("restock-alert-status")).toHaveTextContent(
        "We'll email you when this is back in stock.",
      );
    });
    expect(mockCreateRestockAlert).toHaveBeenCalledWith("printing-1", "normal", "NM");
  });

  it("shows a sign-in prompt when the customer isn't authenticated", async () => {
    mockCreateRestockAlert.mockRejectedValue(new Error("Not authenticated"));

    render(<RestockAlertButton printingId="printing-1" finishCode="foil" conditionCode="lp" />);

    fireEvent.click(screen.getByTestId("restock-alert-button"));

    await waitFor(() => {
      expect(screen.getByTestId("restock-alert-status")).toHaveTextContent(
        "Sign in to your account to set a restock alert.",
      );
    });
  });

  it("shows a generic error message for any other failure", async () => {
    mockCreateRestockAlert.mockRejectedValue(new Error("Database unavailable"));

    render(<RestockAlertButton printingId="printing-1" finishCode="foil" conditionCode="lp" />);

    fireEvent.click(screen.getByTestId("restock-alert-button"));

    await waitFor(() => {
      expect(screen.getByTestId("restock-alert-status")).toHaveTextContent(
        "Couldn't set the restock alert. Please try again.",
      );
    });
  });
});
