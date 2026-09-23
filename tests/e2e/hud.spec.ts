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
    const canvas = await page.locator(SEL.spriteCanvas).first().boundingBox();
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
    // direct *sprite* canvas child (Phaser's) plus the 3D world canvas when the
    // 3D renderer runs, with the HUD's own canvases (minimap base + live layer)
    // nested inside the layer. `#game-container canvas` would otherwise resolve
    // to the minimap — which is exactly what broke the focus clicks and the
    // world-brain scene snapshot when the layer landed.
    await expect(page.locator(SEL.spriteCanvas)).toHaveCount(1);
    await expect(page.locator(SEL.world3dCanvas)).toHaveCount(1);
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

  test("the status card is compact, self-explaining, and shows the class resource", async ({
    page,
  }) => {
    const collector = await bootToOverworld(page);

    const card = page.locator(SEL.playerStatusCard);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Two bars — health and the class's primary resource — each printing its
    // value inside the track, which is what lets the card be this narrow.
    await expect(card.locator(".player-card__bar--hp .hud-progress")).toHaveCount(1);
    await expect(card.locator(".player-card__bar--resource .hud-progress")).toHaveCount(1);
    await expect(card.locator(".player-card__bar-value")).toHaveCount(2);

    // Five rating slots, none earned: the server does not score the courier yet.
    await expect(card.locator(".player-card__stamp")).toHaveCount(5);
    await expect(card.locator(".player-card__stamp--earned")).toHaveCount(0);

    // Half the footprint it shipped with (242px at HUD scale).
    const container = await page.locator(SEL.gameContainer).boundingBox();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(container).not.toBeNull();
    expect(box!.width / container!.width, "card footprint").toBeLessThan(0.16);

    // Every row says what it is on hover, at this size.
    await expect(card.locator(".player-card__bar--hp")).toHaveAttribute("title", /Health/);
    await expect(card.locator(".player-card__bar--resource")).toHaveAttribute(
      "title",
      /(Stamina|Mana|Focus)/,
    );
    await expect(card.locator(".player-card__rating")).toHaveAttribute("title", /Courier rating/);
    await expect(card.locator(".player-card__name")).toHaveAttribute("title", /courier name/);
    await expect(card.locator(".player-card__level")).toHaveAttribute("title", /level/);

    // The resource the bar names is the courier's own class resource.
    const classId = await page.evaluate(
      () =>
        (window as unknown as { pawsCharacters?: { class_id: number }[] })
          .pawsCharacters?.[0]?.class_id ?? null,
    );
    const expected = classId === 2 ? "mana" : classId === 3 ? "focus" : "stamina";
    await expect(card.locator(".player-card__bar--resource")).toHaveAttribute(
      "data-resource",
      expected,
    );
    // ... and that resource's colour is the one painted on the track.
    await expect(card.locator(".player-card__bar--resource .hud-progress")).toHaveClass(
      new RegExp(`player-card__bar-track--${expected}`),
    );

    // Nothing spills out of a card this small.
    const overflow = await card.evaluate((node) =>
      [...node.querySelectorAll<HTMLElement>(".player-card__details > *")].map((row) => ({
        cls: row.className,
        over: row.scrollWidth - row.clientWidth,
      })),
    );
    for (const row of overflow) {
      expect(row.over, `${row.cls} overflows by ${row.over}px`).toBeLessThanOrEqual(1);
    }

    await screenshot(page, "hud.png");
    collector.expectClean();
  });

  test("the quest tracker collapses to its tab, reopens, and stacks above the chat", async ({
    page,
  }) => {
    const collector = await bootToOverworld(page);

    const tracker = page.locator(SEL.questTrackerRoot);
    const tab = page.locator(SEL.questTrackerTab);
    await expect(tracker).toBeVisible({ timeout: 15_000 });

    // Collapsing hides the card body. The defect was that it hid the chevron
    // too, leaving nothing on screen that could expand it again.
    await page.locator(SEL.questTrackerToggle).click();
    await expect(tracker).toHaveClass(/quest-tracker--collapsed/);
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute("aria-expanded", "false");

    // The tab is the way back.
    await tab.click();
    await expect(tracker).not.toHaveClass(/quest-tracker--collapsed/);
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SEL.questTracker)).toBeVisible();

    // Bottom-left column: same left edge as the chat, entirely above it.
    const trackerBox = await tracker.boundingBox();
    const chatBox = await page.locator(SEL.chatBox).boundingBox();
    expect(trackerBox).not.toBeNull();
    expect(chatBox).not.toBeNull();
    expect(Math.abs(trackerBox!.x - chatBox!.x)).toBeLessThanOrEqual(1);
    expect(
      trackerBox!.y + trackerBox!.height,
      "the tracker is stacked above the chat",
    ).toBeLessThanOrEqual(chatBox!.y + 1);

    collector.expectClean();
  });

  test("the chat collapses to its header, reopens, and stays see-through", async ({ page }) => {
    const collector = await bootToOverworld(page);

    const chat = page.locator(SEL.chatBox);
    const body = page.locator(SEL.chatBoxBody);
    const toggle = page.locator(SEL.chatBoxToggle);
    await expect(chat).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(SEL.chatBoxToggle)).toBeVisible();

    // Collapsing hides the log and composer — but the header holding the
    // toggle has to survive, or nothing on screen could reopen the chat.
    await toggle.click();
    await expect(chat).toHaveClass(/chat-box--collapsed/);
    await expect(body).toBeHidden();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".chat-box__title")).toBeVisible();

    await toggle.click();
    await expect(chat).not.toHaveClass(/chat-box--collapsed/);
    await expect(body).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Translucent, not opaque: the world has to read through the log. The
    // dark panel recipe is rgba(23, 54, 31, 0.92); the chat overrides it with a
    // lower alpha, so this measures the painted colour rather than the CSS text.
    const alpha = await chat.evaluate((node) => {
      const colour = getComputedStyle(node).backgroundColor;
      const match = /rgba?\(([^)]+)\)/.exec(colour);
      const parts = match === null ? [] : match[1].split(",").map((p) => Number(p.trim()));
      return parts.length === 4 ? parts[3] : 1;
    });
    expect(alpha, "chat panel background alpha").toBeLessThan(0.8);

    collector.expectClean();
  });

  test("the skill boxes are plain boxes keyed 1-4, with no tray chrome", async ({ page }) => {
    const collector = await bootToOverworld(page);

    const bar = page.locator(SEL.skillBar);
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // Four boxes, keyed 1-4 (the basic attack is the first).
    const slots = page.locator(`${SEL.skillBar} ${SEL.skillSlot}`);
    await expect(slots).toHaveCount(4);
    await expect(page.locator(`${SEL.skillBar} ${SEL.skillSlotKey}`)).toHaveText([
      "1",
      "2",
      "3",
      "4",
    ]);

    // No tray: the bar itself paints nothing, so the boxes sit on the world.
    const barBackground = await bar.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(barBackground).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await expect(page.locator(`${SEL.skillBar} .hud-tray__leaf`)).toHaveCount(0);
    await expect(page.locator(`${SEL.skillBar} .skill-bar__hint`)).toHaveCount(0);

    // Only the server-backed basic attack is live.
    await expect(slots.nth(0)).toBeEnabled();
    await expect(slots.nth(1)).toBeDisabled();

    // Clicking the live box runs the same basic-attack path as the 1 key and
    // answers with its press feedback.
    await slots.nth(0).click();
    await expect(slots.nth(0)).toHaveClass(/skill-slot--pressed/);

    collector.expectClean();
  });

  test("the top bar is the only account surface", async ({ page }) => {
    const collector = await bootToOverworld(page);

    // The floating courier pill used to render at viewport top-left and land
    // on top of the brand. There is now exactly one account surface: the top
    // bar's dropdown, and it is the one the harness opens.
    await expect(page.locator(".character-menu, .character-menu__button")).toHaveCount(0);
    await expect(page.locator(SEL.topBar)).toHaveCount(1);

    await expect(page.locator(SEL.courierMenuPanel)).toBeHidden();
    await page.locator(SEL.courierMenuButton).click();
    await expect(page.locator(SEL.courierMenuPanel)).toBeVisible();
    await expect(
      page.locator(`${SEL.courierMenuPanel} button`, { hasText: "Create a new courier" }),
    ).toBeVisible();

    // Escape (and any outside click) dismisses it again.
    await page.keyboard.press("Escape");
    await expect(page.locator(SEL.courierMenuPanel)).toBeHidden();

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
