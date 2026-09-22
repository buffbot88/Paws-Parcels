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
    const ws = observeWebSocket(page, collector.frames);
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

  test("frames the courier below centre and leads the walk", async ({ page }) => {
    const collector = await bootToOverworld(page);
    await focusCanvas(page);

    /** Where the courier renders, relative to the viewport centre, in screen px. */
    const readFraming = async () =>
      page.evaluate(() => {
        const scene = (window as unknown as {
          game: { scene: { getScene: (key: string) => never } };
        }).game.scene.getScene("overworld") as unknown as {
          player: { x: number; y: number };
          cameras: {
            main: {
              zoom: number;
              height: number;
              followOffset: { x: number; y: number };
              worldView: { x: number; y: number; width: number; height: number };
            };
          };
        };
        const camera = scene.cameras.main;
        const view = camera.worldView;
        return {
          offsetXPx: (scene.player.x - (view.x + view.width / 2)) * camera.zoom,
          offsetYPx: (scene.player.y - (view.y + view.height / 2)) * camera.zoom,
          viewportHeightPx: camera.height,
          zoom: camera.zoom,
          followOffsetXPx: camera.followOffset.x,
          followOffsetYPx: camera.followOffset.y,
        };
      });

    // Idle: the courier sits below centre (the world ahead gets more of the
    // frame) and stays laterally centred.
    await page.waitForTimeout(500);
    const idle = await readFraming();
    const bias = idle.offsetYPx / idle.viewportHeightPx;
    expect(bias).toBeGreaterThan(0.03);
    expect(bias).toBeLessThan(0.25);
    expect(Math.abs(idle.offsetXPx)).toBeLessThan(6);
    expect(idle.followOffsetYPx).toBeGreaterThan(0);
    expect(Math.abs(idle.followOffsetXPx)).toBeLessThan(6);

    // Walking north: the camera leads the direction of travel. Asserted on the
    // follow offset rather than on where the courier renders, because the
    // camera's follow *lag* also moves the courier in the frame — the offset is
    // the rule itself, the rendered position is the rule plus the smoothing.
    await holdKey(page, "w");
    await page.waitForTimeout(1_600);
    const walking = await readFraming();
    await releaseKey(page, "w");
    const leadWorldPx = 0.6 * 48;
    expect(walking.followOffsetYPx).toBeGreaterThan(idle.followOffsetYPx + leadWorldPx * 0.9);
    expect(walking.followOffsetYPx).toBeLessThanOrEqual(idle.followOffsetYPx + leadWorldPx + 0.5);

    // Stopping unwinds the lead, so the frame settles back to the idle bias.
    await page.waitForTimeout(1_600);
    const settled = await readFraming();
    expect(Math.abs(settled.followOffsetYPx - idle.followOffsetYPx)).toBeLessThan(2);
    expect(Math.abs(settled.followOffsetXPx)).toBeLessThan(2);

    // A lateral walk leads sideways instead, and must not add to the bias.
    await holdKey(page, "d");
    await page.waitForTimeout(1_600);
    const eastward = await readFraming();
    await releaseKey(page, "d");
    expect(eastward.followOffsetXPx).toBeLessThan(-leadWorldPx * 0.9);
    expect(eastward.followOffsetXPx).toBeGreaterThanOrEqual(-leadWorldPx - 0.5);
    expect(Math.abs(eastward.followOffsetYPx - idle.followOffsetYPx)).toBeLessThan(2);
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
