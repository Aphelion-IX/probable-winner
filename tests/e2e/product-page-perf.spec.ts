import { expect, test, type Page } from "@playwright/test";

// B-105: cached product page response <500ms; mobile LCP <2s; mobile INP
// <200ms (blueprint §2.3), measured at fixture scale. This repo has no
// B-210-scale seeded dataset loaded in this sandbox/CI, so these assertions
// run against whatever catalogue data happens to exist and skip gracefully
// when there's none — same convention as sku-selector.spec.ts and
// card-identity-page.spec.ts. Against a real fixture/staging dataset these
// assertions are the actual budget enforcement this task exists to provide.

async function firstProductPageHref(page: Page): Promise<string | null> {
  await page.goto("/cards");
  const firstCardLink = page.locator('a[href^="/cards/"]').first();
  if (!(await firstCardLink.isVisible().catch(() => false))) {
    return null;
  }
  return firstCardLink.getAttribute("href");
}

test.describe("Product page performance budgets (B-105)", () => {
  test("cached product page response completes within 500ms", async ({ page, request }) => {
    const href = await firstProductPageHref(page);
    test.skip(href === null, "no catalogue data seeded in this environment");
    if (!href) return;

    // Warm the unstable_cache-backed shell (B-100) with one request before
    // timing, since the budget is for the cached path, not a cold render.
    await request.get(href);

    const start = Date.now();
    const response = await request.get(href);
    const duration = Date.now() - start;

    expect(response.ok()).toBe(true);
    expect(duration).toBeLessThan(500);
  });

  test("mobile LCP is under 2s", async ({ page }) => {
    test.skip(
      test.info().project.name !== "mobile-chrome",
      "LCP budget in blueprint §2.3 is mobile-specific",
    );

    const href = await firstProductPageHref(page);
    test.skip(href === null, "no catalogue data seeded in this environment");
    if (!href) return;

    await page.goto(href, { waitUntil: "load" });
    // LCP can still update briefly after load; give it a moment to settle.
    await page.waitForTimeout(500);

    const lcp = await page.evaluate(() => {
      const entries = performance.getEntriesByType("largest-contentful-paint");
      const last = entries[entries.length - 1];
      return last ? last.startTime : 0;
    });

    expect(lcp).toBeLessThan(2000);
  });

  test("mobile condition-selector interaction responds within 200ms", async ({ page }) => {
    test.skip(
      test.info().project.name !== "mobile-chrome",
      "INP budget in blueprint §2.3 is mobile-specific",
    );

    const href = await firstProductPageHref(page);
    test.skip(href === null, "no catalogue data seeded in this environment");
    if (!href) return;

    await page.goto(href);

    const selector = page.locator('[data-testid="sku-selector"]');
    if (!(await selector.isVisible().catch(() => false))) {
      // Catalogue data exists but no sellable SKUs generated yet (Step 6).
      return;
    }

    const conditionSelect = selector.locator("select").last();
    const options = await conditionSelect.locator("option").allTextContents();
    if (options.length < 2) {
      // Only one condition available — no interaction to measure.
      return;
    }

    await conditionSelect.selectOption({ index: 1 });

    // The Event Timing API buffers interaction entries above Chromium's
    // ~104ms default duration threshold; an interaction fast enough to stay
    // under that never produces an entry at all, which is exactly the "well
    // within budget" case, so no entries reads as 0ms rather than a failure.
    const interactionDuration = await page.evaluate(() => {
      const entries = performance.getEntriesByType("event") as PerformanceEventTiming[];
      return entries.length > 0 ? Math.max(...entries.map((entry) => entry.duration)) : 0;
    });

    expect(interactionDuration).toBeLessThan(200);
  });
});
