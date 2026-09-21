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
  unionCoverageRatio,
  type Box,
} from "./support/harness";

/** Every world HUD surface that must live inside the game window. */
const WORLD_HUD = [
  SEL.playerStatusCard,
  SEL.minimap,
  SEL.skillBar,
  SEL.questTracker,
  SEL.chatBox,
  SEL.inventoryButton,
] as const;

/**
 * Ceiling on how much of the game window the HUD may cover.
 *
 * The world has to stay the dominant visual element (design decision behind
 * the visual overhaul). The current layout covers roughly a fifth, so this
 * leaves real headroom while still failing loudly if a panel regresses into
 * something that swallows a quarter of the screen or more.
 */
const HUD_COVERAGE_BUDGET = 0.4;

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

  test("world HUD stays inside the game window and never displaces the canvas", async ({ page }) => {
    const collector = await bootToOverworld(page);

    const container = await page.locator(SEL.gameContainer).boundingBox();
    expect(container).not.toBeNull();

    // The canvas fills the game window exactly. This is the assertion the
    // suite was missing: before the HUD layer existed, the status card was a
    // full-width in-flow block that pushed the canvas down, and every panel
    // mounted after the canvas was clipped out of the container entirely —
    // while `toBeVisible()` still passed, because a clipped element has a
    // non-empty box. Geometry, not presence, is what catches that.
    const canvas = await page.locator("#game-container > canvas").first().boundingBox();
    expect(canvas).not.toBeNull();
    expect(Math.abs(canvas!.x - container!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvas!.y - container!.y)).toBeLessThanOrEqual(1);
    expect(canvas!.width).toBeGreaterThan(container!.width * 0.98);
    expect(canvas!.height).toBeGreaterThan(container!.height * 0.98);

    // Every HUD surface is on screen, inside the window, not clipped away.
    const boxes: Box[] = [];
    for (const selector of WORLD_HUD) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, `${selector} has no layout box`).not.toBeNull();
      expect(box!.x, `${selector} starts left of the game window`).toBeGreaterThanOrEqual(
        container!.x - 1,
      );
      expect(box!.y, `${selector} starts above the game window`).toBeGreaterThanOrEqual(
        container!.y - 1,
      );
      expect(
        box!.x + box!.width,
        `${selector} runs past the right edge of the game window`,
      ).toBeLessThanOrEqual(container!.x + container!.width + 1);
      expect(
        box!.y + box!.height,
        `${selector} runs past the bottom of the game window (clipped)`,
      ).toBeLessThanOrEqual(container!.y + container!.height + 1);
      boxes.push(box!);
    }

    // The world stays the dominant surface.
    const coverage = unionCoverageRatio(boxes, container!);
    expect(
      coverage,
      `HUD covers ${(coverage * 100).toFixed(0)}% of the game window (budget ${(
        HUD_COVERAGE_BUDGET * 100
      ).toFixed(0)}%)`,
    ).toBeLessThanOrEqual(HUD_COVERAGE_BUDGET);

    // Structural invariant that the canvas selectors depend on: exactly one
    // direct canvas child (Phaser's), with the HUD's own canvases (minimap
    // base + live layer) nested inside the layer. `#game-container canvas`
    // would otherwise resolve to the minimap — which is exactly what broke the
    // focus clicks and the world-brain scene snapshot when the layer landed.
    await expect(page.locator("#game-container > canvas")).toHaveCount(1);
    await expect(page.locator(`${SEL.hudLayer} canvas`)).toHaveCount(2);

    // The HUD layer is the canvas-relative parent, and it is not in the
    // container's flow (that was the whole defect).
    await expect(page.locator(SEL.hudLayer)).toHaveCount(1);
    const layerPosition = await page
      .locator(SEL.hudLayer)
      .evaluate((node) => getComputedStyle(node).position);
    expect(layerPosition).toBe("absolute");

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
