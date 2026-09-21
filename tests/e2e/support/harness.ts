/**
 * Playwright harness for the Paws & Parcels runtime validation suite.
 *
 * Owns the cross-cutting concerns the specs share:
 *   - dev-login boot to the authenticated Overworld (the first milestone);
 *   - console/pageerror/network collection with the spec's failure rules
 *     (fail on uncaught exceptions, failed essential assets, failed WS auth,
 *     and 5xx from required game endpoints; tolerate optional/dev-only 404s);
 *   - WebSocket observation via the Playwright WebSocket event;
 *   - screenshot checkpoints under artifacts/playwright/.
 *
 * Everything here asserts deterministic, observable behavior. Nothing asserts
 * subjective visual quality — that remains a human visual-review task.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Playwright runs from the project root (config location); artifacts land there. */
const PROJECT_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Selectors (stable DOM ids/classes shipped by the HUD; no test instrumentation)
// ---------------------------------------------------------------------------

export const SEL = {
  topBar: "#top-navbar",
  gameContainer: "#game-container",
  /** Canvas-relative world HUD layer (HUD v4). */
  hudLayer: "#hud-layer",
  courierMenuButton: ".character-menu__button",
  courierMenuPanel: ".character-menu__panel",
  courierCreateAction: ".character-menu__action", // identified by label at call site
  playerStatusCard: "#player-hp",
  questTracker: ".quest-tracker__header",
  skillBar: ".skill-bar",
  inventoryButton: ".inventory-button",
  minimap: ".minimap",
  minimapStatus: ".minimap__server",
  minimapCoords: ".minimap__coords",
  minimapZone: ".minimap__zone",
  zoneLabel: ".top-navbar__zone",
  characterDesk: "#character-desk",
  deskNameInput: "#desk-name",
  deskCreateSubmit: ".desk-form .desk-btn--primary",
  classOption: ".class-option",
  charPlayButton: ".char-option__play",
  profilePanel: ".profile-panel",
  profileTabButton: ".profile-panel__tab",
  localMapPanel: ".local-map-panel",
  localMapClose: ".local-map-panel__close",
  localMapSearch: ".local-map-panel__search",
  localMapLocations: ".local-map-panel__locations",
  localMapLocation: ".local-map-panel__location",
  localMapWaypoint: ".local-map-panel__waypoint",
  dialoguePanel: ".dialogue-panel",
  chatBox: ".chat-box",
  connectionDiagnostic: ".connection-diagnostic",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsoleIssue {
  kind: "pageerror" | "console-error" | "asset-failed" | "http-5xx" | "ws-failed";
  detail: string;
}

export interface RuntimeIssueCollector {
  issues: ConsoleIssue[];
  /** Direction-tagged WS frames seen so far (for seeding a WS recorder). */
  frames: Array<{ direction: "inbound" | "outbound"; payload: unknown }>;
  /** Assert no collected issue violates the runtime-failure rules. */
  expectClean(): void;
}

export interface GameProbe {
  sceneKey: string | null;
  mapId: string | null;
  player: { x: number; y: number; tileX: number; tileY: number } | null;
  monsterCount: number;
  monsters: Array<{ id: string; defKey: string; hpRatio: number; x: number; y: number }>;
  remotePlayerIds: number[];
  networkStatus: string | null;
  authCharacterId: number | null;
}

// ---------------------------------------------------------------------------
// Console / network / WebSocket collection
// ---------------------------------------------------------------------------

/**
 * Built-client asset requests (hashed names under /static/) must never 404.
 * Other 404s (favicon, optional dev-only resources) are tolerated per spec.
 */
const BUILT_ASSET_RE = /\/static\//;

export function collectRuntimeIssues(page: Page): RuntimeIssueCollector {
  const issues: ConsoleIssue[] = [];
  const framesSeen: Array<{ direction: "inbound" | "outbound"; payload: unknown }> = [];

  page.on("pageerror", (error) => {
    issues.push({ kind: "pageerror", detail: String(error?.message ?? error) });
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    issues.push({ kind: "console-error", detail: message.text() });
  });

  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 500 && url.includes("/api/")) {
      issues.push({ kind: "http-5xx", detail: `${status} ${url}` });
      return;
    }
    if (status === 404 && BUILT_ASSET_RE.test(url)) {
      issues.push({ kind: "asset-failed", detail: `404 ${url}` });
    }
  });

  page.on("websocket", (ws) => {
    ws.on("socketerror", () => {
      issues.push({ kind: "ws-failed", detail: `socketerror ${ws.url()}` });
    });
    ws.on("framereceived", (frame) => {
      framesSeen.push({ direction: "inbound", payload: frame.payload });
    });
    ws.on("framesent", (frame) => {
      framesSeen.push({ direction: "outbound", payload: frame.payload });
    });
  });

  return {
    issues,
    /** Frames seen so far (direction-tagged) for seeding a WS recorder. */
    frames: framesSeen,
    expectClean() {
      expect(
        issues,
        `runtime issues observed:\n${issues.map((i) => `[${i.kind}] ${i.detail}`).join("\n")}`,
      ).toEqual([]);
    },
  };
}

/** A frame already captured by another listener, replayed into the recorder. */
export interface SeededFrame {
  direction: "inbound" | "outbound";
  payload: unknown;
}

/**
 * Observe the game WebSocket through the collector's live frame log.
 *
 * Playwright's `page.on("websocket")` only reports sockets opened after the
 * listener is registered, and the game socket connects during boot — so the
 * recorder must read the SAME live array the issue collector has been filling
 * since before navigation (pass `collector.frames`). The collector's listener
 * stays attached for the page's lifetime, so frames after reload/reconnect are
 * captured too.
 */
export function observeWebSocket(
  page: Page,
  frames: SeededFrame[] = [],
): {
  frames: SeededFrame[];
  types(direction: "inbound" | "outbound"): string[];
  messages(direction: "inbound" | "outbound"): Array<Record<string, unknown>>;
  sawOutboundType(type: string): boolean;
  sawInboundType(type: string): boolean;
  waitForInboundType(type: string, timeoutMs?: number): Promise<void>;
} {
  if (frames.length === 0) {
    // Standalone use (no collector): record frames for sockets opened from now
    // on. Prefer `collector.frames` when the socket already connected.
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => frames.push({ direction: "inbound", payload: frame.payload }));
      ws.on("framesent", (frame) => frames.push({ direction: "outbound", payload: frame.payload }));
    });
  }

  const messageType = (frame: SeededFrame): string | null => {
    if (typeof frame.payload !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(frame.payload);
      if (typeof parsed !== "object" || parsed === null) return null;
      const type = (parsed as Record<string, unknown>).type;
      return typeof type === "string" ? type : null;
    } catch {
      return null;
    }
  };

  const types = (direction: "inbound" | "outbound"): string[] =>
    frames
      .filter((frame) => frame.direction === direction)
      .map(messageType)
      .filter((type): type is string => type !== null);

  const messages = (direction: "inbound" | "outbound"): Array<Record<string, unknown>> =>
    frames
      .filter((frame) => frame.direction === direction)
      .map((frame) => {
        if (typeof frame.payload !== "string") return null;
        try {
          const parsed: unknown = JSON.parse(frame.payload);
          return typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      })
      .filter((msg): msg is Record<string, unknown> => msg !== null);

  return {
    frames,
    types,
    messages,
    sawOutboundType: (type) => types("outbound").includes(type),
    sawInboundType: (type) => types("inbound").includes(type),
    waitForInboundType: (type, timeoutMs = 15_000) =>
      expect
        .poll(() => types("inbound").includes(type), {
          timeout: timeoutMs,
          message: `expected an inbound "${type}" WebSocket frame`,
        })
        .toBe(true),
  };
}

// ---------------------------------------------------------------------------
// White-box probes into window.game (Phaser is deliberately exposed for tests)
// ---------------------------------------------------------------------------

/** Minimal structural shape of the client internals we probe from the page. */
interface GameInternals {
  game?: {
    scene?: {
      getScene?: (key: string) => unknown;
    };
  };
}

interface SceneInternals {
  scene?: { key?: string };
  mapData?: { id?: string };
  player?: { x?: number; y?: number };
  network?: {
    getStatus?: () => { status?: string };
    myCharacterId?: number | null;
    remotePlayers?: Map<number, unknown>;
    monsters?: Map<string, unknown>;
  };
}

interface MonsterInternals {
  id?: string;
  defKey?: string;
  hpBar?: { width?: number };
  x?: number;
  y?: number;
}

export const TILE_SIZE = 48;
export const SCENE_KEY_OVERWORLD = "overworld";

/** Read deterministic scene/network state (null fields when not booted). */
export async function readGameProbe(page: Page): Promise<GameProbe> {
  return page.evaluate(() => {
    const win = window as unknown as GameInternals;
    // Phaser's SceneManager returns null (not undefined) while the scene is
    // not yet running — guard both so the probe never throws mid-boot.
    const scene = (win.game?.scene?.getScene?.("overworld") ?? null) as SceneInternals | null;
    if (scene === null) {
      return {
        sceneKey: null,
        mapId: null,
        player: null,
        monsterCount: 0,
        monsters: [] as Array<{ id: string; defKey: string; hpRatio: number; x: number; y: number }>,
        remotePlayerIds: [] as number[],
        networkStatus: null,
        authCharacterId: null,
      };
    }
    const network = scene.network;
    const player = scene.player;
    const tileSize = 48;
    const px = typeof player?.x === "number" ? player.x : 0;
    const py = typeof player?.y === "number" ? player.y : 0;
    const monsters: Array<{ id: string; defKey: string; hpRatio: number; x: number; y: number }> = [];
    if (network?.monsters instanceof Map) {
      for (const value of network.monsters.values()) {
        const m = value as MonsterInternals;
        // The client monster renders an HP bar whose width (36px full) is the
        // only authoritative-HP mirror on the entity.
        const barWidth = Number(m.hpBar?.width ?? 36);
        monsters.push({
          id: String(m.id ?? ""),
          defKey: String(m.defKey ?? ""),
          hpRatio: Math.max(0, Math.min(1, barWidth / 36)),
          x: Number(m.x ?? 0),
          y: Number(m.y ?? 0),
        });
      }
    }
    const remoteIds: number[] =
      network?.remotePlayers instanceof Map ? [...network.remotePlayers.keys()] : [];
    return {
      sceneKey: scene.scene?.key ?? null,
      mapId: scene.mapData?.id ?? null,
      player: {
        x: px,
        y: py,
        tileX: Math.floor(px / tileSize),
        tileY: Math.floor(py / tileSize),
      },
      monsterCount: monsters.length,
      monsters,
      remotePlayerIds: remoteIds,
      networkStatus: network?.getStatus?.().status ?? null,
      authCharacterId: network?.myCharacterId ?? null,
    };
  });
}

/** Wait until the probe reports the joined overworld matching `predicate`. */
export async function expectGameProbe(
  page: Page,
  predicate: (probe: GameProbe) => boolean,
  timeoutMs = 20_000,
  message = "expected game probe condition",
): Promise<GameProbe> {
  await expect
    .poll(async () => {
      const probe = await readGameProbe(page);
      return probe.sceneKey !== null && predicate(probe) ? "ok" : JSON.stringify(probe);
    }, { timeout: timeoutMs, message })
    .toBe("ok");
  return readGameProbe(page);
}

/** The authenticated, WebSocket-joined Overworld probe condition. */
export function isJoinedOverworld(probe: GameProbe): boolean {
  return (
    probe.sceneKey === SCENE_KEY_OVERWORLD &&
    probe.mapId !== null &&
    probe.networkStatus === "joined" &&
    probe.authCharacterId !== null
  );
}

// ---------------------------------------------------------------------------
// Boot flows
// ---------------------------------------------------------------------------

/**
 * Open the dev-login entry. The client only opens its login overlay with
 * `auth=1`, and the dev-login shortcut additionally needs `dev-login=1`
 * (localhost only) — see src/ui/LoginOverlay.ts.
 */
export async function gotoDevLogin(page: Page): Promise<void> {
  // `domcontentloaded`, not `load`: the dev client pulls Phaser plus the whole
  // eager art pack through Vite, and the dev-login overlay reloads the page as
  // soon as the session is issued — waiting on `load` can outlast the timeout.
  // Every meaningful state is awaited explicitly afterwards.
  await page.goto("/?auth=1&dev-login=1", { waitUntil: "domcontentloaded" });
}

/**
 * Give every test a fresh courier: open the in-game courier menu and force
 * the create desk so a NEW character row is created. Without this, the server
 * restores the shared dev account's last-played courier — including whatever
 * zone/position a previous test left it in — and state bleeds between tests.
 */
export async function startFreshCourier(page: Page): Promise<void> {
  const menuButton = page.locator(SEL.courierMenuButton);
  // The menu mounts only after Phaser boots — give it a short window and skip
  // silently when we are genuinely pre-boot (the auto-play path).
  const menuAppeared = await menuButton
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!menuAppeared) return;
  await menuButton.click();
  // The create action is identified by label, not order: the panel lists
  // courier rows first, then "Character, bag & skills", then create.
  await page.locator(`${SEL.courierMenuPanel} button`, { hasText: "Create a new courier" }).click();
  await expect(page.locator(SEL.deskNameInput)).toBeVisible({ timeout: 15_000 });
}

/**
 * Complete the local dev-auth harness: dev-login issues the session, the
 * desk flow creates/selects a courier, and the client boots into the
 * Overworld with a joined WebSocket.
 *
 * Handles all three desk steps (create / select / auto-play) so the harness
 * stays correct whether or not the dev account already has a courier.
 */
export async function bootToOverworld(
  page: Page,
  options: { characterName?: string } = {},
): Promise<RuntimeIssueCollector> {
  const collector = collectRuntimeIssues(page);
  await gotoDevLogin(page);

  // The overlay issues the session then reloads the page.
  await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });

  // State isolation: force the create desk so every test plays a NEW courier
  // instead of restoring whatever zone/position a previous test persisted.
  await startFreshCourier(page);

  // Desk flow: create when the name field is offered, click Play on the
  // select screen when existing couriers are offered. A single-courier
  // account skips the desk entirely (auto-play).
  const nameInput = page.locator(SEL.deskNameInput);
  const desk = page.locator(SEL.characterDesk);
  try {
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    // Create step: name the courier, pick the first class, start delivering.
    const characterName = options.characterName ?? `Courier${Date.now() % 100000}`;
    await nameInput.fill(characterName);
    await page.locator(SEL.classOption).first().click();
    await page.locator(SEL.deskCreateSubmit).click();
  } catch {
    // Not the create step — try the select step.
    const play = page.locator(SEL.charPlayButton);
    try {
      await expect(play.first()).toBeVisible({ timeout: 10_000 });
      await play.first().click();
    } catch {
      // Auto-play path; nothing to click.
    }
  }

  await expect
    .poll(async () => {
      const probe = await readGameProbe(page);
      return isJoinedOverworld(probe) ? "ok" : JSON.stringify(probe);
    }, {
      timeout: 45_000,
      intervals: [500, 1_000, 2_000],
      message: "expected the authenticated Overworld with a joined WebSocket",
    })
    .toBe("ok");

  // The desk must be gone once the game is playing.
  await expect(desk).toBeHidden({ timeout: 15_000 });

  return collector;
}

/**
 * Reload the page and wait for the session to restore into the joined
 * Overworld (used by hud + reconnect specs to exercise the reload path).
 */
export async function reloadAndRestore(page: Page): Promise<RuntimeIssueCollector> {
  const collector = collectRuntimeIssues(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => {
      const probe = await readGameProbe(page);
      return isJoinedOverworld(probe) ? "ok" : JSON.stringify(probe);
    }, {
      timeout: 45_000,
      intervals: [500, 1_000, 2_000],
      message: "expected session restore into the joined Overworld after reload",
    })
    .toBe("ok");
  return collector;
}

// ---------------------------------------------------------------------------
// Movement + screenshots
// ---------------------------------------------------------------------------

/** Hold a movement/action key (Phaser receives it once the canvas is focused). */
export async function holdKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
}

/** Release a held key. */
export async function releaseKey(page: Page, key: string): Promise<void> {
  await page.keyboard.up(key);
}

/**
 * Focus the game canvas so Phaser receives keyboard events.
 *
 * The Phaser canvas specifically (`> canvas`): #hud-layer precedes it inside
 * #game-container and contains the minimap's own canvases, so a descendant
 * selector would click the minimap instead.
 */
export async function focusCanvas(page: Page): Promise<void> {
  await page.locator("#game-container > canvas").first().click({ position: { x: 20, y: 20 } });
}

/** Stable-name screenshot checkpoint under artifacts/<subdirectory>/. */
export async function screenshotTo(
  page: Page,
  subdirectory: string,
  name: string,
): Promise<string> {
  const dir = resolve(PROJECT_ROOT, "artifacts", subdirectory);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, name);
  await page.screenshot({ path, fullPage: false });
  return path;
}

/** Stable-name screenshot checkpoint under artifacts/playwright/. */
export async function screenshot(page: Page, name: string): Promise<string> {
  return screenshotTo(page, "playwright", name);
}

// ---------------------------------------------------------------------------
// HUD geometry (Pass 1: the world HUD must never eat the game window)
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fraction of `container` covered by the union of `boxes`.
 *
 * Overlapping panels must not be double-counted, or a HUD that stacks two
 * cards on one corner would look like it covers twice the screen it does.
 * A coarse deterministic grid samples each cell's centre and asks whether any
 * box covers that point — cell count is fixed, so the result is stable.
 */
export function unionCoverageRatio(
  boxes: Box[],
  container: Box,
  grid = 48,
): number {
  if (container.width <= 0 || container.height <= 0) return 0;
  let covered = 0;
  for (let row = 0; row < grid; row += 1) {
    const y = container.y + ((row + 0.5) / grid) * container.height;
    for (let column = 0; column < grid; column += 1) {
      const x = container.x + ((column + 0.5) / grid) * container.width;
      const hit = boxes.some(
        (box) =>
          x >= box.x &&
          x <= box.x + box.width &&
          y >= box.y &&
          y <= box.y + box.height,
      );
      if (hit) covered += 1;
    }
  }
  return covered / (grid * grid);
}
