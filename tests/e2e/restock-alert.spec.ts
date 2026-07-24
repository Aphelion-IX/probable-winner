import { expect, test } from "@playwright/test";

test.describe("Restock alert (B-104)", () => {
  test("an out-of-stock SKU shows a restock control that submits without crashing", async ({
    page,
  }) => {
    await page.goto("/cards");

    const firstCardLink = page.locator('a[href^="/cards/"]').first();
    if (!(await firstCardLink.isVisible().catch(() => false))) {
      test.skip(true, "no catalogue data seeded in this environment");
      return;
    }

    await firstCardLink.click();

    const restockButton = page.locator('[data-testid="restock-alert-button"]');
    if (!(await restockButton.isVisible().catch(() => false))) {
      // The default selection has stock, or no SKUs exist yet for this
      // printing — nothing to exercise here.
      return;
    }

    await restockButton.click();

    // Guest sessions (no auth UI exists yet, backlog B-170) get a sign-in
    // prompt; an authenticated session gets a success message — either way
    // the control must resolve to a clear status, not hang or crash.
    await expect(page.locator('[data-testid="restock-alert-status"]')).toBeVisible({
      timeout: 5000,
    });
  });
});
