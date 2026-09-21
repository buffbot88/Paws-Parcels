/**
 * Dev-auth harness spec — the entry gate for the whole runtime suite.
 *
 * Verifies the local dev-login path (never production credentials):
 *   - `?auth=1&dev-login=1` issues a session and strips the query params;
 *   - the authenticated boot lands on a valid desk/game outcome;
 *   - the harness reaches the Character Desk flow (create or select).
 */
import { test, expect } from "@playwright/test";
import { SEL, gotoDevLogin, screenshot } from "./support/harness";

test.describe("dev-auth harness", () => {
  test("dev-login issues a session and reaches the Character Desk", async ({ page }) => {
    await gotoDevLogin(page);

    // The dev-login overlay posts the session and then reloads the page; wait
    // for a real authenticated outcome rather than checking mid-navigation.
    // Either the courier desk is shown (create/select) or the game booted
    // straight in (single/remembered courier) — the minimap only exists then.
    const deskVisible = page.locator(`${SEL.characterDesk}.character-desk--visible`);
    const gameBooted = page.locator(SEL.minimap);
    await expect(deskVisible.or(gameBooted).first()).toBeVisible({ timeout: 45_000 });

    // The dev-login query must be stripped after the harness hand-off.
    await expect(page).toHaveURL((url) => !url.searchParams.has("dev-login"));

    // Report which harness outcome we landed on: create form, select list, or
    // straight into the world. All three are valid dev-auth outcomes.
    const createStep = await page.locator(SEL.deskNameInput).isVisible().catch(() => false);
    const selectStep = await page
      .locator(SEL.charPlayButton)
      .first()
      .isVisible()
      .catch(() => false);
    const playing = await gameBooted.isVisible().catch(() => false);
    expect(createStep || selectStep || playing).toBe(true);

    await screenshot(page, "auth-desk.png");
  });
});
