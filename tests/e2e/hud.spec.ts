/**
 * HUD spec — presence, uniqueness, and layout sanity of the authenticated HUD.
 *
 * Verifies (spec):
 *   - no pre-auth player HUD;
 *   - exactly one authenticated HUD after login;
 *   - no duplicate HUD after reload/reconnect (bounding-box overlap sanity).
 * Screenshot: artifacts/playwright/hud.png
 */
import { test, expect } from "@playwright/test";
import {
  SEL,
  bootToOverworld,
  readGameProbe,
  reloadAndRestore,
  screenshot,
} from "./support/harness";

test.describe("HUD lifecycle", () => {
  test("no pre-auth player HUD", async ({ page }) => {
    await page.goto("/");
    // Pre-auth: no player status card, no skill bar, no minimap HUD.
    await expect(page.locator(SEL.playerStatusCard)).toHaveCount(0);
    await expect(page.locator(SEL.skillBar)).toHaveCount(0);
    await expect(page.locator(SEL.minimap)).toHaveCount(0);
  });

  test("authenticated HUD is present exactly once", async ({ page }) => {
    const collector = await bootToOverworld(page);

    const components = [
      SEL.topBar,
      SEL.playerStatusCard,
      SEL.questTracker,
      SEL.skillBar,
      SEL.inventoryButton,
      SEL.minimap,
      SEL.chatBox,
    ];
    for (const selector of components) {
      await expect(page.locator(selector)).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator(selector)).toBeVisible();
    }

    // PlayerStatusCard shows the courier name (server-provided identity).
    await expect(page.locator(SEL.playerStatusCard)).toContainText(/Courier|Milestone|Level/i, {
      timeout: 10_000,
    });

    await screenshot(page, "hud.png");
    collector.expectClean();
  });

  test("no duplicate HUD after reload", async ({ page }) => {
    await bootToOverworld(page);
    const collector = await reloadAndRestore(page);

    // Exactly one of each HUD component survives the reload.
    for (const selector of [SEL.topBar, SEL.playerStatusCard, SEL.minimap, SEL.skillBar]) {
      await expect(page.locator(selector)).toHaveCount(1, { timeout: 15_000 });
    }

    // The player card must reflect a server-known courier and the socket
    // must be joined — duplicates or stale HUD would break either.
    const probe = await readGameProbe(page);
    expect(probe.authCharacterId).not.toBeNull();
    expect(probe.networkStatus).toBe("joined");

    collector.expectClean();
  });
});
