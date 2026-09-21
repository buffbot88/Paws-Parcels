/** TEMPORARY diagnostic spec — deleted after the investigation. */
import { test } from "@playwright/test";
import { bootToOverworld, focusCanvas, readGameProbe } from "./support/harness";

test("diag: I key delivery + map DOM", async ({ page }) => {
  await bootToOverworld(page);

  // --- I key delivery ---
  const before = await page.evaluate(() => {
    const scene = (window as unknown as { game?: { scene?: { getScene?: (k: string) => unknown } } })
      .game?.scene?.getScene?.("overworld") as {
      inputSystem?: { inventoryQueued?: boolean };
      input?: { keyboard?: { enabled?: boolean; keys?: Record<number, { isDown?: boolean }> } };
    } | null;
    const panel = document.querySelector<HTMLElement>(".profile-panel");
    return {
      activeElement: `${document.activeElement?.tagName ?? "none"}:${(document.activeElement as HTMLElement | null)?.className ?? ""}`,
      keyboardEnabled: scene?.input?.keyboard?.enabled ?? null,
      hasKeyI: scene?.input?.keyboard?.keys?.[73] !== undefined,
      keyIDown: scene?.input?.keyboard?.keys?.[73]?.isDown ?? null,
      queued: scene?.inputSystem?.inventoryQueued ?? null,
      panelExists: panel !== null,
      panelHidden: panel?.hidden ?? null,
    };
  });
  console.log("DIAG_BEFORE_I", JSON.stringify(before));

  await focusCanvas(page);
  await page.keyboard.press("i");
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const scene = (window as unknown as { game?: { scene?: { getScene?: (k: string) => unknown } } })
      .game?.scene?.getScene?.("overworld") as {
      inputSystem?: { inventoryQueued?: boolean };
      input?: { keyboard?: { keys?: Record<number, { isDown?: boolean }> } };
    } | null;
    const panel = document.querySelector<HTMLElement>(".profile-panel");
    return {
      activeElement: `${document.activeElement?.tagName ?? "none"}:${(document.activeElement as HTMLElement | null)?.className ?? ""}`,
      keyIDown: scene?.input?.keyboard?.keys?.[73]?.isDown ?? null,
      queued: scene?.inputSystem?.inventoryQueued ?? null,
      panelExists: panel !== null,
      panelHidden: panel?.hidden ?? null,
      profilePanelExists: document.querySelectorAll(".profile-panel").length,
    };
  });
  console.log("DIAG_AFTER_I", JSON.stringify(after));

  // --- Map panel DOM ---
  await page.keyboard.press("m");
  await page.waitForTimeout(500);
  const map = await page.evaluate(() => {
    const panels = document.querySelectorAll(".local-map-panel");
    const first = panels[0] as HTMLElement | undefined;
    const buttons = document.querySelectorAll(".local-map-panel__location");
    return {
      panelCount: panels.length,
      firstHidden: first?.hidden ?? null,
      locationButtons: buttons.length,
      hiddenAttrCount: Array.from(buttons).filter((b) => (b as HTMLElement).hidden).length,
      firstText: buttons[0]?.textContent ?? null,
      firstDisplay: buttons[0] ? getComputedStyle(buttons[0]).display : null,
    };
  });
  console.log("DIAG_MAP", JSON.stringify(map));

  await page.locator(".local-map-panel__search").fill("post");
  await page.waitForTimeout(300);
  const afterSearch = await page.evaluate(() => {
    const buttons = document.querySelectorAll(".local-map-panel__location");
    return {
      locationButtons: buttons.length,
      hiddenAttrCount: Array.from(buttons).filter((b) => (b as HTMLElement).hidden).length,
      displays: Array.from(buttons).map((b) => getComputedStyle(b).display),
      searchValue: (document.querySelector(".local-map-panel__search") as HTMLInputElement | null)?.value ?? null,
    };
  });
  console.log("DIAG_MAP_SEARCH", JSON.stringify(afterSearch));

  const probe = await readGameProbe(page);
  console.log("DIAG_PROBE", JSON.stringify({ mapId: probe.mapId, tile: probe.player }));
});
