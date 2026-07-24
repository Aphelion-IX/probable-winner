import { expect, test } from "@playwright/test";

test.describe("Account profile (B-170)", () => {
  test("a guest visiting /account sees a sign-in prompt instead of a crash", async ({ page }) => {
    const response = await page.goto("/account");

    expect(response?.ok()).toBe(true);
    await expect(page.locator("h1")).toContainText("Account");
    await expect(page.locator('[data-testid="account-status"]')).toContainText("Sign in");
  });
});
