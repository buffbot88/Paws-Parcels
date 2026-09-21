/**
 * Boot spec — the FIRST MILESTONE. Nothing else in the suite may be treated
 * as green until this passes reliably.
 *
 * Automated flow: dev-login → CharacterDesk → create/select courier →
 * normal ws-token flow → Boot → Preloader → Overworld.
 *
 * Verifies: Phaser canvas exists, no fatal console errors, no unhandled page
 * exceptions, WebSocket connects + authenticates, Clover Village loads.
 * Screenshot: artifacts/playwright/clover-village-baseline.png
 */
import { test, expect } from "@playwright/test";
import {
  SEL,
  bootToOverworld,
  expectGameProbe,
  isJoinedOverworld,
  observeWebSocket,
  readGameProbe,
  screenshot,
} from "./support/harness";

test.describe("boot: reach the Overworld", () => {
  test("dev-login boots into a joined Clover Village", async ({ page }) => {
    const collector = await bootToOverworld(page, { characterName: "Milestone" });
    const ws = observeWebSocket(page, collector.frames);

    // Phaser canvas exists (direct child; the minimap's canvases are nested).
    await expect(page.locator("#game-container > canvas")).toHaveCount(1);
    const canvasBox = await page.locator("#game-container > canvas").first().boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(100);
    expect(canvasBox!.height).toBeGreaterThan(100);

    // WebSocket: connected, authenticated, zone joined (server frames).
    await ws.waitForInboundType("authenticated", 20_000);
    await ws.waitForInboundType("zone_state", 20_000);

    // Clover Village is loaded (white-box probe + visible labels).
    const probe = await expectGameProbe(
      page,
      (p) => p.mapId === "zone-clover-village",
      15_000,
      "expected the Overworld scene on zone-clover-village",
    );
    expect(probe.authCharacterId).not.toBeNull();
    await expect(page.locator(SEL.zoneLabel)).toContainText("Clover Village", { timeout: 10_000 });
    await expect(page.locator(SEL.minimapStatus)).toHaveAttribute("data-status", "joined", { timeout: 10_000 });

    // No connection-diagnostic panel may be visible on a healthy boot.
    await expect(page.locator(SEL.connectionDiagnostic)).toHaveCount(0);

    // No pre-auth HUD may exist; exactly one authenticated HUD (lifecycle).
    await expect(page.locator(SEL.playerStatusCard)).toHaveCount(1);

    await screenshot(page, "clover-village-baseline.png");

    // Runtime hygiene last so it covers the whole session so far.
    expect(ws.sawOutboundType("authenticate")).toBe(true);
    collector.expectClean();
  });

  test("boot is repeatable (reload restores the same courier)", async ({ page }) => {
    const first = await bootToOverworld(page);
    const probeBefore = await expectGameProbe(page, isJoinedOverworld);

    const ws = observeWebSocket(page, first.frames);
    await page.reload();
    await expect
      .poll(async () => {
        const probe = await readGameProbe(page);
        return isJoinedOverworld(probe) ? "ok" : JSON.stringify(probe);
      }, { timeout: 45_000, message: "expected a joined Overworld after reload" })
      .toBe("ok");

    const probeAfter = await readGameProbe(page);
    expect(probeAfter.authCharacterId).toBe(probeBefore.authCharacterId);

    // Exactly one authenticated HUD after the reload (no duplicates).
    await expect(page.locator(SEL.playerStatusCard)).toHaveCount(1);
    await expect(page.locator(SEL.topBar)).toHaveCount(1);

    await ws.waitForInboundType("zone_state", 20_000);
    first.expectClean();
  });
});
