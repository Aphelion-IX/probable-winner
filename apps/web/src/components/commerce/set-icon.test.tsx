import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetIcon } from "./set-icon";

describe("SetIcon", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an img with the given url and alt text", () => {
    render(<SetIcon url="https://svgs.scryfall.io/sets/mh2.svg" alt="Modern Horizons 2" />);

    const img = screen.getByAltText("Modern Horizons 2");
    expect(img).toHaveAttribute("src", "https://svgs.scryfall.io/sets/mh2.svg");
  });

  it("renders nothing when there is no url", () => {
    const { container } = render(<SetIcon url={null} alt="Modern Horizons 2" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("marks decorative icons (empty alt) as aria-hidden", () => {
    render(<SetIcon url="https://svgs.scryfall.io/sets/mh2.svg" alt="" />);

    expect(document.querySelector("img")).toHaveAttribute("aria-hidden", "true");
  });
});
