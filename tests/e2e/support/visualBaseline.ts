/**
 * Visual baseline captures (visual overhaul, Step 0).
 *
 * The overhaul is judged against a fixed set of framings rather than one
 * screenshot at a time, so every pass is compared against the same picture of
 * the same places.
 *
 * Two capture modes, deliberately kept distinct:
 *
 *   1. **Camera-framed** — stops the camera's follow and centres it on a
 *      landmark tile, so all eight review framings come out of one fast run
 *      without walking anywhere. This touches *rendering only*: the courier's
 *      server-owned position, collision, and presence are untouched, and no
 *      production code is involved — the suite already probes `window.game`
 *      deliberately (see harness.ts).
 *   2. **Player view** — a plain screenshot with the camera following the
 *      courier, so at least one frame per run is exactly what a player sees
 *      rather than a director's framing.
 *
 * Anchors are read from the live scene's authored map data (`mapData`
 * interactables/transitions, NPC home tiles) rather than hardcoded tile
 * numbers, so the captures track the map generator when the layout changes.
 *
 * Output: PNGs plus `manifest.json` under artifacts/visual-baseline/
 * (gitignored — these are review scratch, not source).
 */
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = process.cwd();
const BASELINE_DIR = resolve(PROJECT_ROOT, "artifacts", "visual-baseline");
const MANIFEST_PATH = resolve(BASELINE_DIR, "manifest.json");

/** Live-scene handles reached through the deliberately exposed window.game. */
interface SceneHandles {
  scene?: {
    mapData?: {
      id?: string;
      name?: string;
      width?: number;
      height?: number;
      spawn?: { x?: number; y?: number };
      interactables?: Array<{
        id?: string;
        label?: string;
        x?: number;
        y?: number;
      }>;
      transitions?: Array<{
        id?: string;
        label?: string;
        x?: number;
        y?: number;
        toZone?: string;
      }>;
    };
    visualNpcs?: Array<{
      definition?: {
        id?: string;
        name?: string;
        homeTile?: { x?: number; y?: number };
      };
      x?: number;
      y?: number;
    }>;
    cameras?: { main?: CameraHandles };
    world3d?: World3DHandles | null;
  } | null;
  game?: { scene?: { getScene?: (key: string) => unknown } };
}

interface CameraHandles {
  zoom?: number;
  scrollX?: number;
  scrollY?: number;
  centerOn?: (x: number, y: number) => void;
  stopFollow?: () => void;
}

/** The 3D world renderer, reached the same way the sprite camera is. */
interface World3DHandles {
  setFocusOverride?: (focus: { x: number; z: number } | null) => void;
}

export interface Landmark {
  id: string;
  label: string;
  kind: "interactable" | "transition" | "npc";
  x: number;
  y: number;
}

export interface LandmarkSet {
  zoneId: string | null;
  zoneName: string | null;
  spawn: { x: number; y: number } | null;
  landmarks: Landmark[];
}

export interface CameraState {
  zoom: number;
  /** Sprite renderer: world pixels. 3D renderer: the ground focus, in tiles. */
  scrollX: number;
  scrollY: number;
  /** Which renderer framed the capture, and where the 3D camera was parked. */
  renderer?: "sprite" | "world3d";
  focus?: { x: number; z: number };
}

export type CaptureMode = "camera-framed" | "player-view" | "hud-state";

export interface BaselineEntry {
  id: string;
  file: string;
  mode: CaptureMode;
  purpose: string;
  zoneId: string | null;
  zoneName: string | null;
  /** Camera-framed captures only: the anchor the camera was centred on. */
  anchor: { id: string; label: string; x: number; y: number } | null;
  camera: CameraState | null;
  viewport: { width: number; height: number };
  capturedAt: string;
}

const entries: BaselineEntry[] = [];

/** Read the current zone's authored landmarks (data-driven anchors). */
export async function readLandmarks(page: Page): Promise<LandmarkSet> {
  return page.evaluate(() => {
    const scene = ((window as unknown as SceneHandles).game?.scene?.getScene?.(
      "overworld",
    ) ?? null) as SceneHandles["scene"];
    const map = scene?.mapData;
    if (scene == null || map == null) {
      return {
        zoneId: null,
        zoneName: null,
        spawn: null,
        landmarks: [] as Landmark[],
      };
    }
    const landmarks: Landmark[] = [];
    for (const object of map.interactables ?? []) {
      if (typeof object.x !== "number" || typeof object.y !== "number") continue;
      landmarks.push({
        id: String(object.id ?? ""),
        label: String(object.label ?? object.id ?? ""),
        kind: "interactable",
        x: object.x,
        y: object.y,
      });
    }
    for (const transition of map.transitions ?? []) {
      if (typeof transition.x !== "number" || typeof transition.y !== "number") {
        continue;
      }
      landmarks.push({
        id: String(transition.id ?? ""),
        label: String(transition.label ?? transition.id ?? ""),
        kind: "transition",
        x: transition.x,
        y: transition.y,
      });
    }
    // NPCs render from their authored home tiles; the scene holds the live
    // entities, so read the definition rather than hardcoding positions.
    for (const npc of scene.visualNpcs ?? []) {
      const definition = npc.definition;
      const tile = definition?.homeTile;
      if (typeof tile?.x !== "number" || typeof tile?.y !== "number") continue;
      landmarks.push({
        id: String(definition?.id ?? ""),
        label: String(definition?.name ?? definition?.id ?? ""),
        kind: "npc",
        x: tile.x,
        y: tile.y,
      });
    }
    return {
      zoneId: typeof map.id === "string" ? map.id : null,
      zoneName: typeof map.name === "string" ? map.name : null,
      spawn:
        typeof map.spawn?.x === "number" && typeof map.spawn?.y === "number"
          ? { x: map.spawn.x, y: map.spawn.y }
          : null,
      landmarks,
    };
  });
}

/**
 * Stop the camera following the courier and centre it on a tile.
 *
 * Rendering-only: nothing here writes gameplay state, and neither renderer's
 * `update()` reclaims the camera on its own, so the framing holds until the
 * test changes it. The 3D renderer needs its own path — its camera is placed
 * from tiles every frame, so stopping Phaser's camera would frame nothing.
 */
export async function frameCameraOnTile(
  page: Page,
  tileX: number,
  tileY: number,
  tileSize = 48,
): Promise<CameraState | null> {
  const state = await page.evaluate(
    ({ tx, ty, size }) => {
      const scene = ((window as unknown as SceneHandles).game?.scene?.getScene?.(
        "overworld",
      ) ?? null) as SceneHandles["scene"];
      const world = scene?.world3d ?? null;
      if (world != null && typeof world.setFocusOverride === "function") {
        // Tile centre, in the world units the 3D renderer uses (1 tile = 1).
        // The focus *is* the transform here: the camera's position is a
        // constant offset from it, and reading the live camera would record
        // the previous frame's placement.
        const focus = { x: tx + 0.5, z: ty + 0.5 };
        world.setFocusOverride(focus);
        return {
          zoom: 1,
          scrollX: focus.x,
          scrollY: focus.z,
          renderer: "world3d" as const,
          focus,
        };
      }
      const camera = scene?.cameras?.main;
      if (camera == null) return null;
      camera.stopFollow?.();
      camera.centerOn?.(tx * size, ty * size);
      return {
        zoom: Number(camera.zoom ?? 0),
        scrollX: Number(camera.scrollX ?? 0),
        scrollY: Number(camera.scrollY ?? 0),
        renderer: "sprite" as const,
      };
    },
    { tx: tileX, ty: tileY, size: tileSize },
  );
  // Two frames is the least that guarantees the world has re-rendered at the
  // new camera transform before the screenshot is taken.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
  return state;
}

/** Screenshot into the baseline directory and record the manifest entry. */
export async function capture(
  page: Page,
  entry: {
    id: string;
    purpose: string;
    mode: CaptureMode;
    landmarks?: LandmarkSet;
    anchor?: Landmark | null;
    camera?: CameraState | null;
  },
): Promise<string> {
  mkdirSync(BASELINE_DIR, { recursive: true });
  const file = `${entry.id}.png`;
  const path = resolve(BASELINE_DIR, file);
  await page.screenshot({ path, fullPage: false });
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  entries.push({
    id: entry.id,
    file,
    mode: entry.mode,
    purpose: entry.purpose,
    zoneId: entry.landmarks?.zoneId ?? null,
    zoneName: entry.landmarks?.zoneName ?? null,
    anchor:
      entry.anchor == null
        ? null
        : {
            id: entry.anchor.id,
            label: entry.anchor.label,
            x: entry.anchor.x,
            y: entry.anchor.y,
          },
    camera: entry.camera ?? null,
    viewport,
    capturedAt: new Date().toISOString(),
  });
  return path;
}

/** Write the accumulated manifest (call once per run, from afterAll). */
export function writeManifest(): string {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        captureCount: entries.length,
        captures: entries,
      },
      null,
      2,
    )}\n`,
  );
  return MANIFEST_PATH;
}

/** A landmark the caller expects to exist; throws a useful error otherwise. */
export function requireLandmark(
  set: LandmarkSet,
  match: { id?: string; label?: string; kind?: Landmark["kind"] },
): Landmark {
  const found = set.landmarks.find(
    (landmark) =>
      (match.id === undefined || landmark.id === match.id) &&
      (match.label === undefined || landmark.label === match.label) &&
      (match.kind === undefined || landmark.kind === match.kind),
  );
  if (found === undefined) {
    throw new Error(
      `No landmark matching ${JSON.stringify(match)} in zone ${String(set.zoneId)}. ` +
        `Available: ${set.landmarks.map((l) => `${l.kind}:${l.label}`).join(", ")}`,
    );
  }
  return found;
}
