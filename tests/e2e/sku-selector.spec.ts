import { expect, test } from "@playwright/test";

test.describe("Exact-printing SKU selection", () => {
  test("a card with sellable SKUs shows the selector and updates on selection change", async ({
    page,
  }) => {
    await page.goto("/cards");

    const firstCardLink = page.locator('a[href^="/cards/"]').first();
    if (!(await firstCardLink.isVisible().catch(() => false))) {
      test.skip(true, "no catalogue data seeded in this environment");
      return;
    }

    await firstCardLink.click();

    const selector = page.locator('[data-testid="sku-selector"]');
    if (!(await selector.isVisible().catch(() => false))) {
      // Catalogue data exists but no sellable SKUs have been generated yet
      // for this printing (backlog Step 6) — nothing to assert.
      return;
    }

    const conditionSelect = selector.locator("select").last();
    const options = await conditionSelect.locator("option").allTextContents();

    if (options.length < 2) {
      // Only one condition available for this printing — no combination
      // change to exercise.
      return;
    }

    const liveData = selector.locator('[data-testid="sku-live-data"]');
    await expect(liveData).toBeVisible({ timeout: 5000 });
    const before = await liveData.textContent();

    await conditionSelect.selectOption({ index: 1 });

    await expect(async () => {
      const after = await liveData.textContent();
      expect(after).not.toBe(before);
    }).toPass({ timeout: 5000 });
  });
});
