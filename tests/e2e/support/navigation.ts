/**
 * Shared e2e navigation helpers.
 *
 * Travel in this game is server-authoritative: the courier only moves through
 * accepted `move_intent` frames, so reaching another zone means actually
 * walking there with real held keys. This was inline in combat.spec.ts; it
 * lives here now because the visual-baseline captures need the same walk.
 */
import type { Page } from "@playwright/test";
import { holdKey, readGameProbe, releaseKey } from "./harness.ts";

/** The village's south-edge transition tile to Happy Valley (knowledge.md). */
export const TRANSITION_TILE = { x: 37, y: 74 } as const;

/**
 * Walk the lamp-lined southern road from Courier Square to the transition tile.
 * Returns true once the scene has restarted into Happy Valley.
 *
 * Documented as potentially non-deterministic: callers should skip with a
 * blocker note rather than fail when this returns false (see
 * reports/PLAYWRIGHT-RUNTIME-AUDIT.md).
 */
export async function walkToTransition(page: Page): Promise<boolean> {
  const deadline = Date.now() + 90_000;
  let phase: "south" | "done" = "south";
  while (Date.now() < deadline) {
    const probe = await readGameProbe(page);
    if (probe.mapId === "zone-happy-valley") return true;
    if (probe.player === null) return false;

    if (phase === "south") {
      // Hold S toward the southern gate; stop when reaching the transition
      // tile's column or the walk stalls against the fence line.
      await holdKey(page, "s");
      await page.waitForTimeout(1_500);
      await releaseKey(page, "s");
      const after = await readGameProbe(page);
      if (after.player !== null && after.player.tileY >= TRANSITION_TILE.y - 3) {
        phase = "done";
      }
      if (after.player !== null && after.player.tileY <= probe.player.tileY) {
        // Stalled (collision) — jiggle along X to find the gate corridor.
        await holdKey(page, "a");
        await page.waitForTimeout(700);
        await releaseKey(page, "a");
        await holdKey(page, "d");
        await page.waitForTimeout(1_400);
        await releaseKey(page, "d");
      }
    }
  }
  return (await readGameProbe(page)).mapId === "zone-happy-valley";
}
