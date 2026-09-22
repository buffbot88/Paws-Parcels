/**
 * Inventory / Character Profile spec.
 *
 * Verifies (spec):
 *   - pressing `I` opens the Character Profile (courier ledger);
 *   - the inventory section is visible, no duplicate modal;
 *   - Escape closes it;
 *   - opening the profile does not trigger player movement or attack.
 * Screenshot: artifacts/playwright/character-profile.png
 */
import { test, expect } from "@playwright/test";
import {
  SEL,
  bootToOverworld,
  expectGameProbe,
  focusCanvas,
  screenshot,
} from "./support/harness";

test.describe("inventory (Character Profile)", () => {
  test("I opens the profile panel; Escape closes it; no movement side effects", async ({ page }) => {
    const collector = await bootToOverworld(page);
    await focusCanvas(page);
    // Freeze on an open dialogue so any stray movement keypress is swallowed
    // (the update loop feeds keys to the dialogue while it is open).
    const before = await expectGameProbe(page, (p) => p.player !== null);

    await page.keyboard.press("i");

    const panel = page.locator(SEL.profilePanel);
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The profile panel is a singleton: exactly one modal instance.
    await expect(page.locator(SEL.profilePanel)).toHaveCount(1);

    // The panel opens on Character Info; the Inventory tab renders the
    // server-backed ledger grid.
    await panel.locator(SEL.profileTabButton, { hasText: "Inventory" }).click();
    await expect(panel.locator(".inventory-grid")).toBeVisible({ timeout: 15_000 });

    // Server-backed: profile fetch succeeded (panel status line cleared).
    await expect(panel.locator(".profile-panel__status")).toBeHidden({ timeout: 15_000 });

    // No movement or attack was triggered by opening the ledger: the panel
    // holds DOM focus (the canvas is blurred), so no move intent may fire.
    const after = await expectGameProbe(page, (p) => p.player !== null);
    expect(after.player!.tileX).toBe(before.player!.tileX);
    expect(after.player!.tileY).toBe(before.player!.tileY);

    await screenshot(page, "character-profile.png");

    // Escape closes the panel (the panel's own Escape handler).
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden({ timeout: 10_000 });

    collector.expectClean();
  });

  test("the HUD InventoryButton opens the same panel without duplication", async ({ page }) => {
    const collector = await bootToOverworld(page);
    const button = page.locator(SEL.inventoryButton);

    // The control is the satchel glyph and nothing else: no label, no keycap
    // chip. The binding is discoverable from the hover hint instead.
    await expect(button).toHaveText("");
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(button).toHaveAttribute("aria-label", "Open inventory");
    await expect(button).toHaveAttribute("title", "Inventory - I");
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - box!.height), "icon-only control is circular").toBeLessThanOrEqual(
      1,
    );

    await button.click();
    const panel = page.locator(SEL.profilePanel);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(SEL.profilePanel)).toHaveCount(1);

    // Close via the panel's close control.
    await panel.locator(".profile-panel__close").click();
    await expect(panel).toBeHidden({ timeout: 10_000 });

    // Reopen once more to prove the singleton lifecycle is stable.
    await button.click();
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(SEL.profilePanel)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden({ timeout: 10_000 });

    collector.expectClean();
  });
});
