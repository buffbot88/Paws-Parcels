/**
 * Visual baseline captures — the reference frames the visual overhaul is
 * judged against.
 *
 * Why this exists: the overhaul (camera, HUD footprint, terrain integration,
 * landmark scale, density, depth, lighting) can only be reviewed
 * systematically if every pass is compared against the SAME framings. This
 * spec produces them in one run instead of fixing one screenshot at a time.
 *
 * What it does NOT do: assert that anything looks good. Playwright cannot
 * judge composition, camera feel or art direction. Every capture here is
 * `REQUIRES SEELLE/BROWSER VERIFICATION`; the automated value is that the
 * framings are reproducible and the manifest records exactly what was framed.
 *
 * Framings (see design/CloverVillage.png for the reference these answer to):
 *   town-centre, cafe, florist, research-shop, village-edge, happy-valley,
 *   inventory-open, local-map-open — plus spawn-framing and walk-framing, two
 *   true player views with the camera following the courier.
 *
 * Anchors are read from the live scene's authored map data, so a map change
 * moves the captures with it instead of silently framing the wrong place.
 * Output: artifacts/visual-baseline/*.png + manifest.json (gitignored).
 */
import { test, expect } from "@playwright/test";
import {
  bootToOverworld,
  focusCanvas,
  holdKey,
  releaseKey,
} from "./support/harness";
import { walkToTransition } from "./support/navigation";
import {
  capture,
  frameCameraOnTile,
  readLandmarks,
  requireLandmark,
  writeManifest,
} from "./support/visualBaseline";

test.afterAll(() => {
  writeManifest();
});

test.describe("visual baseline: Clover Village framings", () => {
  test("camera-framed landmark captures", async ({ page }) => {
    const collector = await bootToOverworld(page);
    const landmarks = await readLandmarks(page);
    expect(landmarks.zoneId).toBe("zone-clover-village");

    // The dominant centre landmark: the Post Office counter, plaza at (37,28).
    const townCentre = requireLandmark(landmarks, {
      label: "Post Office Counter",
    });
    const camera = await frameCameraOnTile(page, townCentre.x, townCentre.y);
    expect(camera).not.toBeNull();
    await capture(page, {
      id: "town-centre",
      mode: "camera-framed",
      purpose:
        "Post Office as the dominant centre landmark, its plaza, and how the paths leave it",
      landmarks,
      anchor: townCentre,
      camera,
    });

    // The three professions + the shop, each anchored on the NPC/object that
    // lives there rather than on a guessed tile.
    const framings: Array<{
      id: string;
      match: Parameters<typeof requireLandmark>[1];
      purpose: string;
    }> = [
      {
        id: "cafe",
        match: { label: "Biscuit", kind: "npc" },
        purpose: "Café Biscuit frontage, outdoor seating, and its path approach",
      },
      {
        id: "florist",
        match: { label: "Maple", kind: "npc" },
        purpose: "Florist stall, flower beds, and how the shopfront reads at scale",
      },
      {
        id: "research-shop",
        match: { label: "Research Shop Shelf" },
        purpose: "Research shop frontage and its props against the terrain",
      },
    ];
    for (const framing of framings) {
      const anchor = requireLandmark(landmarks, framing.match);
      const state = await frameCameraOnTile(page, anchor.x, anchor.y);
      await capture(page, {
        id: framing.id,
        mode: "camera-framed",
        purpose: framing.purpose,
        landmarks,
        anchor,
        camera: state,
      });
    }

    // The village edge: the southern gate that frames the Happy Valley exit.
    const edge = requireLandmark(landmarks, { kind: "transition" });
    const edgeCamera = await frameCameraOnTile(page, edge.x, edge.y - 3);
    await capture(page, {
      id: "village-edge",
      mode: "camera-framed",
      purpose:
        "Edge of Clover Village: gate, forest boundary, and where the terrain treatment stops",
      landmarks,
      anchor: edge,
      camera: edgeCamera,
    });

    collector.expectClean();
  });

  test("real player views (camera following the courier)", async ({ page }) => {
    const collector = await bootToOverworld(page);
    const landmarks = await readLandmarks(page);
    await focusCanvas(page);

    // Fresh-boot framing: exactly what a player is handed on login, with no
    // camera override at all.
    await capture(page, {
      id: "spawn-framing",
      mode: "player-view",
      purpose:
        "What the player actually sees on arrival — courier, HUD footprint, and world framing together",
      landmarks,
    });

    // The same view mid-walk, so camera-follow behaviour and depth sorting
    // against moving entities are both on screen.
    await holdKey(page, "w");
    await page.waitForTimeout(900);
    await capture(page, {
      id: "walk-framing",
      mode: "player-view",
      purpose: "Camera follow while moving: depth order, shadows, and HUD stability",
      landmarks,
    });
    await releaseKey(page, "w");

    collector.expectClean();
  });

  test("HUD states: inventory ledger and local map", async ({ page }) => {
    const collector = await bootToOverworld(page);
    const landmarks = await readLandmarks(page);
    await focusCanvas(page);

    // Inventory: the server-backed courier ledger over the live world.
    await page.keyboard.press("i");
    await expect(page.locator(".profile-panel")).toBeVisible({ timeout: 15_000 });
    await capture(page, {
      id: "inventory-open",
      mode: "hud-state",
      purpose: "Inventory open: how much world the ledger leaves visible",
      landmarks,
    });
    await page.keyboard.press("Escape");
    await expect(page.locator(".profile-panel")).toBeHidden({ timeout: 10_000 });

    // Local map: the full-screen field guide (deliberately incomplete — no
    // waypoint/pan/zoom — so the capture records its honest state).
    await page.keyboard.press("m");
    await expect(page.locator(".local-map-panel")).toBeVisible({ timeout: 15_000 });
    await capture(page, {
      id: "local-map-open",
      mode: "hud-state",
      purpose: "Local Map open: layout, and whether the illustrated map reads against the world",
      landmarks,
    });
    await page.locator(".local-map-panel__close").click();
    await expect(page.locator(".local-map-panel")).toBeHidden({ timeout: 10_000 });

    collector.expectClean();
  });
});

test.describe("visual baseline: Happy Valley", () => {
  test("Happy Valley arrival framing", async ({ page }) => {
    // Same walk the combat spec uses; a long server-validated journey.
    test.setTimeout(300_000);
    const collector = await bootToOverworld(page);
    await focusCanvas(page);

    const arrived = await walkToTransition(page);
    if (!arrived) {
      // Documented blocker, not a silent gap: travel to the valley is known to
      // be non-deterministic (reports/PLAYWRIGHT-RUNTIME-AUDIT.md). The Clover
      // Village side of the gate is still captured as `village-edge`.
      test.skip(
        true,
        "BLOCKER: non-deterministic navigation to the Happy Valley transition (37,74)",
      );
      return;
    }

    const landmarks = await readLandmarks(page);
    expect(landmarks.zoneId).toBe("zone-happy-valley");
    await capture(page, {
      id: "happy-valley",
      mode: "player-view",
      purpose:
        "Happy Valley arrival: does the second zone share the village's terrain and scale language",
      landmarks,
    });

    collector.expectClean();
  });
});
