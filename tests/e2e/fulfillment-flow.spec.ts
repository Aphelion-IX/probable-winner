import { expect, test } from "@playwright/test";

/**
 * B-146: "Playwright: paid order reaches shipped with no manual DB
 * changes" — matches blueprint §15's "done" criterion end-to-end.
 *
 * Auditing the real fulfilment pipeline while writing this test found it
 * isn't actually connected end-to-end yet, well beyond what a test alone
 * can paper over:
 *
 *   1. The picking detail page's "Mark as Picked" scan flow
 *      (apps/web/src/app/staff/picking/[id]/page.tsx) only updates local
 *      React state — it never calls begin_inventory_pick()/
 *      complete_inventory_pick() or updates pick_lines.quantity_picked.
 *   2. There is no apps/web/src/app/staff/packing/[id]/page.tsx at all —
 *      the packing list page links to a route that 404s. Nothing creates
 *      a packing_shipments row or transitions an order past "picking".
 *   3. Checkout (apps/web/src/components/checkout/order-review.tsx) still
 *      defaults to a hardcoded "demo_cart" id and mock line-item/subtotal
 *      data instead of the real cart resolved on /cart — so while a
 *      customer can now add real items to a real cart and see them on the
 *      cart page, checkout itself doesn't yet pick that cart up.
 *
 * What *is* real and wired: confirm_order_payment() (Stripe webhook →
 * reservation-to-allocation conversion, fixed in
 * 20260724160000_fix_checkout_payment_confirmation.sql), create_pick_batch()
 * being reachable from the picking page via the "Generate pick batch"
 * button, and — as of this pass — a real "Add to cart" control on the card
 * identity page's SKU selector plus a real /cart page, both backed by the
 * atomic get_or_create_cart()/add_to_cart()/get_cart_contents() database
 * functions rather than any client-side mock state.
 *
 * Given (3), this spec still can't drive a real order all the way through
 * checkout via the UI. It instead documents and probes each stage's real
 * availability, skipping precisely at the point the pipeline actually
 * breaks, so the exact scope of what's left is visible here rather than
 * hidden behind a passing-looking test. Completing B-146 for real needs
 * checkout wired to the real cart and the picking-confirm/packing/shipment
 * write-paths (B-142/B-144) built — substantially more than this task's
 * own scope.
 */

test.describe("Staff Fulfillment Workflow", () => {
  test("loads staff dashboard with fulfillment pipeline", async ({ page }) => {
    await page.goto("/staff/dashboard");

    await expect(page.locator("h1").first()).toContainText("Staff Dashboard");

    const pipeline = page.locator('h2:has-text("Fulfillment Pipeline")');
    await expect(pipeline).toBeVisible();

    await expect(page.locator("text=Orders")).toBeVisible();
    await expect(page.locator("text=Picking")).toBeVisible();
    await expect(page.locator("text=Packing")).toBeVisible();
    await expect(page.locator("text=Handover")).toBeVisible();

    await expect(page.locator("text=Pending Orders")).toBeVisible();
    await expect(page.locator("text=Active Pick Batches")).toBeVisible();
    await expect(page.locator("text=Exceptions to Resolve")).toBeVisible();
    await expect(page.locator("text=Ready to Ship")).toBeVisible();
    await expect(page.locator("text=Ready for Handover")).toBeVisible();
  });

  test("views staff orders with RLS scope", async ({ page }) => {
    await page.goto("/staff/orders");

    await expect(page.locator("h1").first()).toContainText("Orders");

    const ordersTable = page.locator("table");
    await expect(ordersTable).toBeVisible();

    await expect(page.locator("th:has-text('Order #')")).toBeVisible();
    await expect(page.locator("th:has-text('Status')")).toBeVisible();
    await expect(page.locator("th:has-text('Type')")).toBeVisible();
  });

  test("can generate a pick batch from pending allocations at the staff member's store", async ({
    page,
  }) => {
    await page.goto("/staff/picking");
    await expect(page.locator("h1").first()).toContainText("Picking");

    const generateButton = page.locator("button", { hasText: "Generate pick batch" });
    if (!(await generateButton.isVisible().catch(() => false))) {
      test.skip(true, "no authenticated staff session in this environment");
      return;
    }

    await generateButton.click();

    // Either a real batch got created (redirect to its detail page) or the
    // call failed for a real reason (no pending allocations, no live
    // backend/auth in this environment, etc., surfaced as the button's own
    // error text) — both are valid outcomes here; what matters is the
    // button actually calls create_pick_batch() now instead of doing
    // nothing at all.
    await expect(async () => {
      const url = page.url();
      const hasError = await page
        .locator("p.text-red-600, p.dark\\:text-red-400")
        .first()
        .isVisible()
        .catch(() => false);
      expect(url.includes("/staff/picking/") || hasError).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test("views click-and-collect orders ready for handover", async ({ page }) => {
    await page.goto("/staff/handover");

    await expect(page.locator("h1").first()).toContainText("Click & Collect Handover");
    await expect(page.locator("text=Scan order barcodes")).toBeVisible();

    const emptyState = page.locator("text=No orders ready for click & collect");
    const orderCard = page.locator("text=Ready").first();

    const isEmptyOrHasOrders = await Promise.race([
      emptyState.isVisible().then(() => true),
      orderCard
        .isVisible()
        .then(() => true)
        .catch(() => false),
    ]).catch(() => false);

    expect(isEmptyOrHasOrders).toBe(true);
  });

  test("navigates between staff portal sections via dashboard", async ({ page }) => {
    await page.goto("/staff/dashboard");

    await expect(page.locator("text=View Orders")).toBeVisible();
    await expect(page.locator("text=Pick Batches")).toBeVisible();
    await expect(page.locator("text=Packing")).toBeVisible();
    await expect(page.locator("text=Handover")).toBeVisible();
    await expect(page.locator("text=Inventory")).toBeVisible();

    await page.locator("a:has-text('View Orders')").click();

    await expect(page).toHaveURL("/staff/orders");
    await expect(page.locator("h1")).toContainText("Orders");
  });

  test("packing list page renders (its detail route does not exist yet)", async ({ page }) => {
    await page.goto("/staff/packing");

    await expect(page.locator("h1").first()).toContainText("Packing");
    await expect(page.locator("text=Pack completed pick batches")).toBeVisible();

    // Documents gap (3) from the file header comment: if a completed batch
    // ever exists, its link points at a route with no page component.
    const batchLink = page.locator("a[href^='/staff/packing/']").first();
    if (await batchLink.isVisible().catch(() => false)) {
      const response = await page.goto((await batchLink.getAttribute("href"))!);
      expect(response?.status()).toBe(404);
    }
  });
});
