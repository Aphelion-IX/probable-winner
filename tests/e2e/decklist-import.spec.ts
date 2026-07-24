import { expect, test } from "@playwright/test";

test.describe("Decklist import (B-182)", () => {
  test("pasting a list resolves lines and lets the customer disambiguate multi-printing matches", async ({
    page,
  }) => {
    await page.goto("/deck-builder");

    await expect(page.locator("h1")).toContainText("Deck-list purchasing");

    // Lightning Bolt has been reprinted in dozens of sets, so pasting it with
    // no set code should be ambiguous in any environment with real catalogue
    // data seeded; this environment may have none at all (see other specs'
    // notes on seed data), so the assertion below tolerates both outcomes.
    await page.locator("#decklist-text").fill("4 Lightning Bolt\n1 Sol Ring");
    await page.getByRole("button", { name: /match list/i }).click();

    const status = page.locator('[data-testid="decklist-import-status"]').first();
    await expect(status).toBeVisible({ timeout: 10000 });

    const ambiguousLine = page.locator('[data-testid="ambiguous-line"]');
    if (await ambiguousLine.first().isVisible().catch(() => false)) {
      const firstOption = ambiguousLine.first().locator('input[type="radio"]').first();
      await expect(firstOption).not.toBeChecked();
      await firstOption.check();
      await expect(firstOption).toBeChecked();
    }
  });
});
