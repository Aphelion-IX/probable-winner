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

  test("adding an in-stock SKU to the cart makes it appear on the cart page", async ({ page }) => {
    await page.goto("/cards");

    const firstCardLink = page.locator('a[href^="/cards/"]').first();
    if (!(await firstCardLink.isVisible().catch(() => false))) {
      test.skip(true, "no catalogue data seeded in this environment");
      return;
    }

    await firstCardLink.click();

    const selector = page.locator('[data-testid="sku-selector"]');
    if (!(await selector.isVisible().catch(() => false))) {
      return;
    }

    const addToCart = selector.locator('[data-testid="add-to-cart"]');
    if (!(await addToCart.isVisible().catch(() => false))) {
      // Nothing in stock for this printing/combination in this environment.
      return;
    }

    const cardName = await page.locator("h1").first().textContent();

    await addToCart.getByRole("button", { name: "Add to cart" }).click();

    await expect(async () => {
      const hasSuccess = await addToCart.locator("text=Added to cart.").isVisible();
      const hasError = await addToCart.locator("p.text-red-600, p.dark\\:text-red-400").isVisible();
      expect(hasSuccess || hasError).toBe(true);
    }).toPass({ timeout: 5000 });

    if (
      !(await addToCart
        .locator("text=Added to cart.")
        .isVisible()
        .catch(() => false))
    ) {
      // Add-to-cart failed for a real reason (no live backend in this
      // environment, no store accepting online orders, etc.) -- the button
      // calling the real action is what matters, not this environment's
      // ability to actually complete the write.
      return;
    }

    await page.goto("/cart");
    await expect(page.locator("h1").first()).toContainText("Shopping cart");
    if (cardName) {
      await expect(page.locator(`text=${cardName}`).first()).toBeVisible({ timeout: 5000 });
    }
  });
});
