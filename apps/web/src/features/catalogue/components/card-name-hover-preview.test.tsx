import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CardNameHoverPreview } from "./card-name-hover-preview";

describe("CardNameHoverPreview", () => {
  afterEach(() => cleanup());

  it("renders the card name as a link and no preview by default", () => {
    render(
      <CardNameHoverPreview
        href="/cards/Sol%20Ring/printing-1"
        name="Sol Ring"
        imageUrl="/sol-ring.jpg"
      />,
    );

    const link = screen.getByRole("link", { name: "Sol Ring" });
    expect(link).toHaveAttribute("href", "/cards/Sol%20Ring/printing-1");
    expect(screen.queryByAltText("Sol Ring")).not.toBeInTheDocument();
  });

  it("shows the preview image on hover and hides it on mouse leave", () => {
    render(
      <CardNameHoverPreview
        href="/cards/Sol%20Ring/printing-1"
        name="Sol Ring"
        imageUrl="/sol-ring.jpg"
      />,
    );

    const link = screen.getByRole("link", { name: "Sol Ring" });
    fireEvent.mouseEnter(link);
    expect(screen.getByAltText("Sol Ring")).toBeInTheDocument();

    fireEvent.mouseLeave(link);
    expect(screen.queryByAltText("Sol Ring")).not.toBeInTheDocument();
  });

  it("does not show a preview when there is no image", () => {
    render(
      <CardNameHoverPreview href="/cards/Sol%20Ring/printing-1" name="Sol Ring" imageUrl={null} />,
    );

    fireEvent.mouseEnter(screen.getByRole("link", { name: "Sol Ring" }));
    expect(screen.queryByAltText("Sol Ring")).not.toBeInTheDocument();
  });
});
