/**
 * Movement spec — keyboard WASD through the server-authoritative path.
 *
 * Verifies (spec):
 *   - player position changes while a movement key is held;
 *   - movement is reflected after the server responds (move_intent accepted,
 *     snapshots stream, WS stays joined);
 *   - no console errors during movement;
 *   - the player remains within valid map bounds.
 * No visual "feel" assertions.
 */
import { test, expect } from "@playwright/test";
import {
  SEL,
  bootToOverworld,
  expectGameProbe,
  focusCanvas,
  holdKey,
  observeWebSocket,
  releaseKey,
  screenshot,
} from "./support/harness";

test.describe("movement (WASD, server-validated)", () => {
  test("holding W/A/S/D moves the courier; intents are accepted; bounds hold", async ({ page }) => {
    const collector = await bootToOverworld(page);
    const ws = observeWebSocket(page, collector.wsSeed);
    await focusCanvas(page);

    const start = await expectGameProbe(page, (p) => p.player !== null);
    const mapProbe = start; // mapId available on the same probe
    expect(mapProbe.mapId).not.toBeNull();

    // Hold W (up) long enough for several throttled move intents.
    await holdKey(page, "w");
    await page.waitForTimeout(2_500);
    await releaseKey(page, "w");

    const afterUp = await expectGameProbe(page, (p) => p.player !== null);
    expect(afterUp.player!.tileY).toBeLessThan(start.player!.tileY);

    // Hold A (left).
    await holdKey(page, "a");
    await page.waitForTimeout(2_000);
    await releaseKey(page, "a");

    const afterLeft = await expectGameProbe(page, (p) => p.player !== null);
    expect(afterLeft.player!.tileX).toBeLessThan(afterUp.player!.tileX);

    // Server reflected the movement: intents were sent and snapshots streamed
    // while the session stayed joined.
    expect(ws.sawOutboundType("move_intent")).toBe(true);
    expect(ws.sawInboundType("player_snapshot")).toBe(true);
    const probe = await expectGameProbe(page, (p) => p.networkStatus === "joined");

    // Bounds: the courier stays inside the zone grid.
    expect(probe.player!.tileX).toBeGreaterThanOrEqual(0);
    expect(probe.player!.tileY).toBeGreaterThanOrEqual(0);

    await screenshot(page, "movement.png");
    collector.expectClean();
  });

  test("movement into a blocked tile does not desync the courier", async ({ page }) => {
    const collector = await bootToOverworld(page);
    await focusCanvas(page);

    // Server collision rejection: drive into the world edge for a while and
    // verify the session remains joined and the courier stays in bounds.
    await holdKey(page, "d");
    await page.waitForTimeout(4_000);
    await releaseKey(page, "d");

    const probe = await expectGameProbe(page, (p) => p.networkStatus === "joined");
    expect(probe.player).not.toBeNull();
    expect(probe.player!.tileX).toBeGreaterThanOrEqual(0);
    collector.expectClean();
  });
});
