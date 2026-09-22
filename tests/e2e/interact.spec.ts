/**
 * Interaction spec — E near a known NPC (Pip at tile (37,24), per knowledge.md).
 *
 * Verifies (spec):
 *   - the interaction badge is a small keycap over the focused target's head,
 *     not a card over the courier;
 *   - `E` opens the dialogue panel;
 *   - the panel advances/closes;
 *   - no console errors during interaction.
 * Screenshots: artifacts/playwright/interaction-badge.png, dialogue.png
 */
import { test, expect } from "@playwright/test";
import {
  TILE_SIZE,
  bootToOverworld,
  focusCanvas,
  holdKey,
  readGameProbe,
  readInteractionPrompt,
  releaseKey,
  screenshot,
  type GameProbe,
} from "./support/harness";

/** Pip's home tile in Clover Village (knowledge.md). */
const PIP_TILE = { x: 37, y: 24 };
/** InteractionSystem.RANGE is 1.2 tiles. */
const INTERACT_RANGE_TILES = 1.25;

function withinRange(probe: GameProbe): boolean {
  if (probe.player === null) return false;
  const dx = probe.player.tileX - PIP_TILE.x;
  const dy = probe.player.tileY - PIP_TILE.y;
  return Math.hypot(dx, dy) <= INTERACT_RANGE_TILES;
}

test.describe("interaction (E, NPC dialogue)", () => {
  test("walking to Pip shows dialogue on E and the panel advances", async ({ page }) => {
    const collector = await bootToOverworld(page);
    await focusCanvas(page);

    // Walk north from the spawn plaza (37,31) toward Pip (37,24) in short
    // bursts until the courier is inside interaction range. The dominant-axis
    // intent keeps the path on the plaza's north-south corridor.
    let probe = await readGameProbe(page);
    let burst = 0;
    while (!withinRange(probe) && burst < 14) {
      await holdKey(page, "w");
      await page.waitForTimeout(500);
      await releaseKey(page, "w");
      await page.waitForTimeout(250);
      probe = await readGameProbe(page);
      burst += 1;
    }
    expect(withinRange(probe), `courier not in range after ${burst} bursts: ${JSON.stringify(probe.player)}`).toBe(true);

    // The affordance: a keycap over the target's head. The card this replaced
    // was 230x34 and followed the *courier* (player.y - 36), so it covered the
    // NPC and read as a banner in the middle of the plaza.
    const pipWorldX = PIP_TILE.x * TILE_SIZE + TILE_SIZE / 2;
    const pipWorldY = PIP_TILE.y * TILE_SIZE + TILE_SIZE / 2;
    // The walk loop's 1.25-tile stop is a hair wider than the interaction range
    // (1.2), so a stop that just failed to reach it gets one short step toward
    // Pip's row before the badge is required.
    let badge = await readInteractionPrompt(page);
    for (let attempt = 0; attempt < 3 && badge?.visible !== true; attempt += 1) {
      const now = await readGameProbe(page);
      const towardPip = (now.player?.y ?? 0) > pipWorldY ? "w" : "s";
      await holdKey(page, towardPip);
      await page.waitForTimeout(250);
      await releaseKey(page, towardPip);
      await page.waitForTimeout(250);
      badge = await readInteractionPrompt(page);
    }
    expect(badge?.visible, "interaction badge over the focused target").toBe(true);
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("E");
    expect(badge!.widthPx, "badge width").toBeLessThanOrEqual(30);
    expect(badge!.heightPx, "badge height").toBeLessThanOrEqual(26);
    // Anchored to the target on the column the courier walked up, and clear of
    // the villager's head and name tag (badge bottom above pipWorldY - 30).
    expect(Math.abs(badge!.x - pipWorldX)).toBeLessThanOrEqual(2);
    expect(badge!.y + badge!.heightPx / 2).toBeLessThanOrEqual(pipWorldY - 30);
    // The still for visual review: the badge and the villager it annotates.
    await screenshot(page, "interaction-badge.png");

    // Press E and expect the dialogue panel to open with canned content.
    await page.keyboard.press("e");
    const panel = page.locator(".dialogue-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator(".dialogue-speaker")).not.toBeEmpty();
    await expect(panel.locator(".dialogue-text")).not.toBeEmpty();

    await screenshot(page, "dialogue.png");

    // Advance through the lines (E/Space feed the panel via the scene loop);
    // the panel closes itself after the final line.
    for (let i = 0; i < 10; i++) {
      const stillOpen = await panel.evaluate((el) => !el.classList.contains("hidden"));
      if (!stillOpen) break;
      await page.keyboard.press("e");
      await page.waitForTimeout(250);
    }
    await expect(panel).toBeHidden({ timeout: 10_000 });

    // The interaction must not have teleported the courier away from Pip.
    const after = await readGameProbe(page);
    expect(after.player).not.toBeNull();
    const drift = Math.hypot(after.player!.tileX - PIP_TILE.x, after.player!.tileY - PIP_TILE.y);
    expect(drift).toBeLessThanOrEqual(4);

    collector.expectClean();
  });
});
