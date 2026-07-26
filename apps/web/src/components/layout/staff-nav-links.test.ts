import { describe, expect, it } from "vitest";

import { STAFF_NAV_SECTIONS, visibleNavSections } from "./staff-nav-links";

describe("visibleNavSections", () => {
  it("keeps links that need no permission when the viewer has none", () => {
    const sections = visibleNavSections([]);
    const hrefs = sections.flatMap((section) => section.links.map((link) => link.href));

    expect(hrefs).toContain("/staff/dashboard");
    expect(hrefs).toContain("/staff/settings");
  });

  it("hides every permission-gated link when the viewer has no permissions", () => {
    const sections = visibleNavSections([]);
    const hrefs = sections.flatMap((section) => section.links.map((link) => link.href));

    expect(hrefs).not.toContain("/staff/inventory");
    expect(hrefs).not.toContain("/staff/customers");
    expect(hrefs).not.toContain("/staff/transfers");
  });

  it("shows a link once its permission is granted", () => {
    const sections = visibleNavSections(["inventory.view"]);
    const hrefs = sections.flatMap((section) => section.links.map((link) => link.href));

    expect(hrefs).toContain("/staff/inventory");
    // Receiving needs inventory.receive, not inventory.view — granting one
    // must not imply the other.
    expect(hrefs).not.toContain("/staff/receiving");
  });

  it("drops a section entirely once all of its links are filtered out", () => {
    const sections = visibleNavSections([]);

    expect(sections.some((section) => section.label === "Catalogue & Inventory")).toBe(false);
    expect(sections.some((section) => section.label === "Overview")).toBe(true);
  });

  it("returns every section for a viewer holding all permissions", () => {
    const everyPermission = STAFF_NAV_SECTIONS.flatMap((section) =>
      section.links
        .map((link) => link.permission)
        .filter((value): value is string => Boolean(value)),
    );

    const sections = visibleNavSections(everyPermission);

    expect(sections).toHaveLength(STAFF_NAV_SECTIONS.length);
    expect(sections.flatMap((section) => section.links)).toHaveLength(
      STAFF_NAV_SECTIONS.flatMap((section) => section.links).length,
    );
  });

  it("exposes the shipping screen behind orders.pack", () => {
    expect(
      visibleNavSections(["orders.pack"])
        .flatMap((section) => section.links)
        .map((link) => link.href),
    ).toContain("/staff/shipping");
  });
});
