/**
 * Local Map spec.
 *
 * Verifies (spec):
 *   - `M` opens the Local Map panel;
 *   - the location list renders and search filters it;
 *   - the waypoint control is visibly disabled ("Coming Soon");
 *   - no pan/zoom behavior is asserted (intentionally not implemented —
 *     the repo forbids restoring unimplemented waypoint/pan/zoom claims).
 * Screenshot: artifacts/playwright/local-map.png
 */
import { test, expect } from "@playwright/test";
import {
  SEL,
  bootToOverworld,
  screenshot,
} from "./support/harness";

test.describe("Local Map panel", () => {
  test("M opens the map; locations render; search filters; waypoint is Coming Soon", async ({ page }) => {
    const collector = await bootToOverworld(page);
    await focusCanvasSafe(page);

    const panel = page.locator(SEL.localMapPanel);
    await expect(panel).toBeHidden();

    // Open with M.
    await page.keyboard.press("m");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Location list renders with entries.
    const locations = panel.locator(SEL.localMapLocation);
    await expect(locations.first()).toBeVisible({ timeout: 10_000 });
    const locationCount = await locations.count();
    expect(locationCount).toBeGreaterThanOrEqual(3);

    // Search filters the list (e.g. "post" → Post Office only). The panel
    // hides non-matching buttons, so at least one location must disappear
    // from the visible set while a match remains.
    await page.locator(SEL.localMapSearch).fill("post");
    await expect(locations.first()).toContainText(/post/i, { timeout: 10_000 });
    const visibleAfterSearch = await locations.locator("button:visible").count();
    expect(visibleAfterSearch).toBeGreaterThan(0);
    expect(visibleAfterSearch).toBeLessThan(locationCount);

    // Reset the filter so the screenshot shows the full panel.
    await page.locator(SEL.localMapSearch).fill("");
    await expect(locations.first()).toBeVisible();
    await expect(locations.locator("button:visible")).toHaveCount(locationCount);

    // Waypoint control is visibly disabled and honestly labeled.
    const waypoint = panel.locator(SEL.localMapWaypoint);
    await expect(waypoint).toBeVisible();
    await expect(waypoint).toBeDisabled();
    await expect(waypoint).toContainText("Coming Soon");

    await screenshot(page, "local-map.png");

    // Close via the close button, then reopen+close with M.
    await panel.locator(SEL.localMapClose).click();
    await expect(panel).toBeHidden({ timeout: 10_000 });
    await page.keyboard.press("m");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("m");
    await expect(panel).toBeHidden({ timeout: 10_000 });

    collector.expectClean();
  });
});

/** The map panel blurs the canvas while open; focus the canvas when closed. */
async function focusCanvasSafe(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("#game-container canvas").first().click({ position: { x: 20, y: 20 } }).catch(() => {
    /* the canvas may not be interactable at this moment; M is document-scoped */
  });
}
