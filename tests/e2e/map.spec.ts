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

    // Search filters the list (e.g. "post" → Post Office only). Read the
    // filter state straight from the DOM (hidden flags) and separately prove
    // the visual outcome: the match is rendered and a non-match is not.
    await page.locator(SEL.localMapSearch).fill("post");
    await expect
      .poll(async () => {
        const state = await readLocationFilterState(page);
        return `${state.unhidden}/${state.total}:${state.firstUnhidden}`;
      }, { timeout: 10_000, message: "expected the search to leave only the matching location" })
      .toMatch(new RegExp(`^1/${locationCount}:.*post`));
    await expect(page.locator(SEL.localMapLocation).first()).toBeVisible();
    await expect(
      page.locator(SEL.localMapLocation).filter({ hasText: "Café" }),
    ).toBeHidden();

    // Reset the filter so the screenshot shows the full panel.
    await page.locator(SEL.localMapSearch).fill("");
    const restored = await readLocationFilterState(page);
    expect(restored.total).toBe(locationCount);
    expect(restored.unhidden).toBe(locationCount);
    await expect(locations.first()).toBeVisible();

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

/** The location list's filter state, read directly from the DOM. */
async function readLocationFilterState(
  page: import("@playwright/test").Page,
): Promise<{ total: number; unhidden: number; firstUnhidden: string }> {
  return page.locator(SEL.localMapLocation).evaluateAll((els) => {
    const unhidden = els.filter((el) => !(el as HTMLElement).hidden);
    return {
      total: els.length,
      unhidden: unhidden.length,
      firstUnhidden: (unhidden[0]?.textContent ?? "").trim().toLowerCase(),
    };
  });
}

/**
 * The map panel blurs the canvas while open; focus the canvas when closed.
 * Targets the Phaser canvas (`> canvas`) because #hud-layer holds the
 * minimap's canvases earlier in the DOM. Best-effort: M is document-scoped, so
 * a failed focus click must not fail the spec.
 */
async function focusCanvasSafe(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator(SEL.spriteCanvas)
    .first()
    .click({ position: { x: 20, y: 20 } })
    .catch(() => {
      /* the panel may be blurring the canvas; M is document-scoped */
    });
}
