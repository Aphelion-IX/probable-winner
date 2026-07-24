import { expect, test } from "@playwright/test";

test.describe("Card identity page", () => {
  test("an unknown printing id renders the not-found page instead of crashing", async ({
    page,
  }) => {
    const response = await page.goto(
      "/cards/nonexistent-card/00000000-0000-0000-0000-000000000000",
    );

    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("Page not found");
  });

  test("cards grid links point at the card identity route", async ({ page }) => {
    await page.goto("/cards");

    await expect(page.locator("h1")).toContainText("Cards");

    const firstCardLink = page.locator('a[href^="/cards/"]').first();
    if (await firstCardLink.isVisible().catch(() => false)) {
      const href = await firstCardLink.getAttribute("href");
      expect(href).toMatch(/^\/cards\/[^/]+\/[^/]+$/);

      await firstCardLink.click();
      await expect(page).toHaveURL(/\/cards\/[^/]+\/[^/]+$/);
    }
  });
});
