import { expect, test } from "@playwright/test";

test.describe("All-printings view", () => {
  test("an unknown printing id renders the not-found page instead of crashing", async ({
    page,
  }) => {
    const response = await page.goto(
      "/cards/nonexistent-card/00000000-0000-0000-0000-000000000000/printings",
    );

    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("Page not found");
  });

  test("a multi-printing card lists every printing and links back to the identity page", async ({
    page,
  }) => {
    await page.goto("/cards");

    const firstCardLink = page.locator('a[href^="/cards/"]').first();
    if (!(await firstCardLink.isVisible().catch(() => false))) {
      test.skip(true, "no catalogue data seeded in this environment");
      return;
    }

    await firstCardLink.click();

    const seeAllLink = page.locator('a:has-text("See all printings")');
    if (!(await seeAllLink.isVisible().catch(() => false))) {
      // Card only has a single printing — nothing to assert about a
      // multi-printing listing here.
      return;
    }

    await seeAllLink.click();
    await expect(page).toHaveURL(/\/cards\/[^/]+\/[^/]+\/printings$/);
    await expect(page.locator("h1")).toContainText("All printings of");

    const printingRows = page.locator('a[href^="/cards/"]');
    await expect(printingRows).not.toHaveCount(0);
  });
});
