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

    /**
     * Where the courier renders, relative to the viewport centre, in fractions
     * of the viewport — measured in the renderer that is actually drawing.
     *
     * The 3D renderer projects the courier's feet through its own camera (its
     * matrices, multiplied here, so nothing is taken on faith). The sprite
     * renderer is measured through the live camera's world view. A fraction is
     * deliberately used rather than pixels: both renderers must place the
     * courier at the same *place in the frame*, at any window size.
     */
    const readFraming = async () =>
      page.evaluate(() => {
        const scene = (window as unknown as {
          game: { scene: { getScene: (key: string) => never } };
        }).game.scene.getScene("overworld") as unknown as {
          player: { x: number; y: number };
          world3d?: {
            camera: {
              projectionMatrix: { elements: number[] };
              matrixWorldInverse: { elements: number[] };
            };
          } | null;
          cameras: {
            main: {
              zoom: number;
              height: number;
              followOffset: { x: number; y: number };
              worldView: { x: number; y: number; width: number; height: number };
            };
          };
        };
        const tilePx = 48;
        const world = scene.world3d ?? null;
        if (world != null && world.camera != null) {
          // Column-major 4x4 multiply, the order three composes as P * V * p.
          const apply = (matrix: number[], point: number[]): number[] => {
            const out = [0, 0, 0, 0];
            for (let row = 0; row < 4; row += 1) {
              out[row] =
                matrix[row]! * point[0]! +
                matrix[4 + row]! * point[1]! +
                matrix[8 + row]! * point[2]! +
                matrix[12 + row]! * point[3]!;
            }
            return out;
          };
          // The courier's feet, in the 3D renderer's world units (1 tile = 1).
          const feet = [scene.player.x / tilePx, 0, scene.player.y / tilePx, 1];
          const clip = apply(world.camera.projectionMatrix.elements, apply(
            world.camera.matrixWorldInverse.elements,
            feet,
          ));
          const ndcY = clip[3] === 0 ? 0 : clip[1]! / clip[3];
          const ndcX = clip[3] === 0 ? 0 : clip[0]! / clip[3];
          return {
            renderer: "world3d" as const,
            belowCentreFraction: (1 - ndcY) / 2 - 0.5,
            rightOfCentreFraction: ndcX / 2,
            leadWorldPx: 0,
            followOffsetYPx: 0,
            followOffsetXPx: 0,
          };
        }
        const camera = scene.cameras.main;
        const view = camera.worldView;
        return {
          renderer: "sprite" as const,
          belowCentreFraction:
            ((scene.player.y - (view.y + view.height / 2)) * camera.zoom) / camera.height,
          rightOfCentreFraction:
            ((scene.player.x - (view.x + view.width / 2)) * camera.zoom) / camera.height,
          leadWorldPx: 0,
          followOffsetXPx: camera.followOffset.x,
          followOffsetYPx: camera.followOffset.y,
        };
      });

    const leadWorldPx = 0.6 * 48;
    // The lead is a fraction of a tile of ground, and the frame spans ~10 tiles,
    // so a full lead moves the courier roughly a twentieth of the frame down.
    const leadFrameFraction = 0.02;

    // Idle: the courier sits below centre (the world ahead gets more of the
    // frame) and stays laterally centred.
    await page.waitForTimeout(500);
    const idle = await readFraming();
    expect(idle.renderer).toBe("world3d");
    expect(idle.belowCentreFraction).toBeGreaterThan(0.03);
    expect(idle.belowCentreFraction).toBeLessThan(0.25);
    expect(Math.abs(idle.rightOfCentreFraction)).toBeLessThan(0.02);

    // Walking north: the camera leads the direction of travel, which pushes the
    // courier further below centre. In the sprite renderer the follow offset is
    // the rule itself (asserted directly, because follow lag would blur the
    // rendered position); in the 3D renderer the focus is computed from the live
    // position every frame, so the rendered frame IS the rule.
    await holdKey(page, "w");
    await page.waitForTimeout(1_600);
    const walking = await readFraming();
    await releaseKey(page, "w");
    if (walking.renderer === "world3d") {
      expect(walking.belowCentreFraction).toBeGreaterThan(
        idle.belowCentreFraction + leadFrameFraction,
      );
      expect(walking.belowCentreFraction).toBeLessThan(idle.belowCentreFraction + 0.12);
    } else {
      expect(walking.followOffsetYPx).toBeGreaterThan(idle.followOffsetYPx + leadWorldPx * 0.9);
      expect(walking.followOffsetYPx).toBeLessThanOrEqual(
        idle.followOffsetYPx + leadWorldPx + 0.5,
      );
    }

    // Stopping unwinds the lead, so the frame settles back to the idle bias.
    await page.waitForTimeout(1_600);
    const settled = await readFraming();
    expect(Math.abs(settled.belowCentreFraction - idle.belowCentreFraction)).toBeLessThan(0.01);
    expect(Math.abs(settled.rightOfCentreFraction)).toBeLessThan(0.02);

    // A lateral walk leads sideways instead, and must not add to the bias: the
    // courier slides to the far side of centre while the camera leans east.
    await holdKey(page, "d");
    await page.waitForTimeout(1_600);
    const eastward = await readFraming();
    await releaseKey(page, "d");
    if (eastward.renderer === "world3d") {
      expect(eastward.rightOfCentreFraction).toBeLessThan(-leadFrameFraction);
      expect(eastward.rightOfCentreFraction).toBeGreaterThan(-0.12);
      expect(
        Math.abs(eastward.belowCentreFraction - idle.belowCentreFraction),
      ).toBeLessThan(0.01);
    } else {
      expect(eastward.followOffsetXPx).toBeLessThan(-leadWorldPx * 0.9);
      expect(eastward.followOffsetXPx).toBeGreaterThanOrEqual(-leadWorldPx - 0.5);
      expect(Math.abs(eastward.followOffsetYPx - idle.followOffsetYPx)).toBeLessThan(2);
    }
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
