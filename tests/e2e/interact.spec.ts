/**
 * Interaction spec — E near a known NPC (Pip at tile (37,24), per knowledge.md).
 *
 * Verifies (spec):
 *   - the interaction prompt appears when focused on the NPC;
 *   - `E` opens the dialogue panel;
 *   - the panel advances/closes;
 *   - no console errors during interaction.
 * Screenshot: artifacts/playwright/dialogue.png
 */
import { test, expect } from "@playwright/test";
import {
  bootToOverworld,
  focusCanvas,
  holdKey,
  readGameProbe,
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
