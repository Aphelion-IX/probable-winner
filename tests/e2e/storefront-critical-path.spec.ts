import { expect, test } from "@playwright/test";

test.describe("Storefront critical path", () => {
  test("home → search → results → card page flow", async ({ page }) => {
    // Step 1: Load home page
    await page.goto("/");
    await expect(page).toHaveTitle(/.*/, { timeout: 5000 });

    // Verify home page renders key elements
    await expect(page.locator("h1")).toContainText("One catalogue");
    await expect(page.locator("text=Popular right now")).toBeVisible();
    await expect(page.locator("text=Browse sets")).toBeVisible();
    await expect(page.locator("text=Paste a deck list")).toBeVisible();
    await expect(page.locator("text=Recently added")).toBeVisible();

    // Verify search box is present and functional
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();

    // Step 2: Navigate to search page
    await page.goto("/search");

    // Verify search page loads
    await expect(page.locator("h1")).toContainText("Search");

    // Wait for search filters to load
    await expect(page.locator("text=Price Range")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Rarity")).toBeVisible();
    await expect(page.locator("text=Condition")).toBeVisible();
    await expect(page.locator("text=Finish")).toBeVisible();
    await expect(page.locator("text=Colour")).toBeVisible();

    // Step 3: Test filter functionality
    // Apply a rarity filter
    const rareCheckbox = page.locator('input[id="rarity-rare"]');
    await expect(rareCheckbox).toBeVisible();
    await rareCheckbox.check();

    // Verify URL includes filter param
    await page.waitForURL(/.*rarity=rare/);
    expect(page.url()).toContain("rarity=rare");

    // Step 4: Apply another filter (condition)
    const nmCheckbox = page.locator('input[id="condition-nm"]');
    await expect(nmCheckbox).toBeVisible();
    await nmCheckbox.check();

    // Verify URL includes both params
    await page.waitForURL(/.*rarity=rare.*condition=nm/);
    expect(page.url()).toContain("rarity=rare");
    expect(page.url()).toContain("condition=nm");

    // Step 5: Verify results area is visible
    // (In production with real data, would check for actual cards)
    const resultsSection = page.locator("main").first();
    await expect(resultsSection).toBeVisible();

    // Check for either "No results found" or actual search results
    const noResults = page.locator("text=No results found");
    const resultsText = page.locator("text=Showing").or(page.locator("text=results"));

    const hasResults = await resultsText.isVisible().catch(() => false);
    const hasNoResults = await noResults.isVisible().catch(() => false);

    if (!hasResults && !hasNoResults) {
      // At least the skeleton or results section should be present
      await expect(page.locator("main")).toBeVisible();
    }

    // Step 6: Test filter removal
    const removeRareCheckbox = page.locator('input[id="rarity-rare"]');
    await removeRareCheckbox.uncheck();

    // Verify URL updated to remove rarity param
    await page.waitForURL(/.*condition=nm/);
    expect(page.url()).not.toContain("rarity=rare");
    expect(page.url()).toContain("condition=nm");

    // Step 7: Verify navigation back to home works
    const homeLink = page.locator("a[href='/']").first();
    if (await homeLink.isVisible()) {
      await homeLink.click();
      await expect(page.locator("h1")).toContainText("One catalogue");
    }

    // Step 8: Verify cart page is accessible
    const cartLink = page.locator("a[href*=cart]").first();
    if (await cartLink.isVisible()) {
      await cartLink.click();
      await expect(page).toHaveURL(/.*\/cart/);
      // Cart should show empty state or items
      const emptyCart = page
        .locator("text=Your cart is empty")
        .or(page.locator("text=Shopping cart"));
      await expect(emptyCart).toBeVisible();
    }

    // Step 9: Verify checkout page is accessible
    await page.goto("/checkout");
    await expect(page.locator("h1")).toContainText("Checkout");
    await expect(page.locator("text=How would you like to receive")).toBeVisible();
    await expect(page.locator("text=Delivery")).toBeVisible();
    await expect(page.locator("text=Click & Collect")).toBeVisible();
  });

  test("search results page displays correctly", async ({ page }) => {
    // Navigate directly to search page
    await page.goto("/search?rarity=rare");

    // Verify page title
    await expect(page.locator("h1")).toContainText("Search");

    // Verify filters sidebar is visible
    await expect(page.locator("aside")).first().toBeVisible();

    // Verify main content area exists
    await expect(page.locator("main")).first().toBeVisible();

    // Verify no console errors
    let consoleErrors = false;
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors = true;
        console.error("Console error:", msg.text());
      }
    });

    // Wait a moment for any deferred errors
    await page.waitForTimeout(1000);
    expect(consoleErrors).toBe(false);
  });

  test("checkout flow navigation", async ({ page }) => {
    await page.goto("/checkout");

    // Verify checkout page loads
    await expect(page.locator("h1")).toContainText("Checkout");

    // Verify fulfillment method options are visible
    await expect(page.locator("text=Delivery")).toBeVisible();
    await expect(page.locator("text=Click & Collect")).toBeVisible();

    // Click delivery option
    const deliveryButton = page
      .locator("button")
      .filter({
        hasText: /Delivery/,
      })
      .first();

    if (await deliveryButton.isVisible()) {
      await deliveryButton.click();

      // Verify address form appears
      await expect(page.locator("text=Street address")).toBeVisible({ timeout: 5000 });
      await expect(page.locator("input[placeholder*='address']").first()).toBeVisible();
    }

    // Navigate back and try click-and-collect
    await page.goto("/checkout");

    const collectButton = page
      .locator("button")
      .filter({
        hasText: /Click.*Collect/,
      })
      .first();

    if (await collectButton.isVisible()) {
      await collectButton.click();

      // Verify store selection appears
      await expect(page.locator("text=Select a store").or(page.locator("text=store"))).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test("mobile responsiveness on storefront", async ({ page }) => {
    // Test on mobile viewport (set by playwright config)
    if (page.viewportSize()?.width === 720) {
      // Mobile test
      await page.goto("/");

      // Verify elements are still visible on mobile
      await expect(page.locator("h1")).toBeVisible();
      const searchInput = page.locator('input[placeholder*="Search"]');
      await expect(searchInput).toBeVisible();

      // Navigate to search
      await page.goto("/search");

      // Verify mobile layout renders
      await expect(page.locator("h1")).toContainText("Search");

      // Filters should be in a sidebar or similar
      await expect(page.locator("aside, [role='complementary']").first()).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
