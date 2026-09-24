/**
 * The 3D world renderer.
 *
 * Phaser still owns the game — input, entities, network, HUD — and the WebGL
 * canvas owns the frame. This spec proves the handover from a real browser:
 * the world canvas exists and fills the window, the sprite camera stepped
 * aside, and the frame is a varied scene rather than a blank buffer. The 3D
 * world is opt-in (`?renderer=3d`); the default session draws the sprite
 * world. Whether the frame *looks* right is a human review task: the captures
 * it writes are the frames to look at.
 */
import { expect, test } from "@playwright/test";
import { SEL, bootToOverworld, focusCanvas, screenshot } from "./support/harness";

interface RenderState {
  world3dAttached: boolean;
  mainCameraVisible: boolean | null;
  world3dCanvas: { width: number; height: number } | null;
  world3dBox: { x: number; y: number; width: number; height: number } | null;
  spriteBox: { x: number; y: number; width: number; height: number } | null;
  containerBox: { x: number; y: number; width: number; height: number } | null;
  hudLayerZ: number;
  worldCanvasZ: number;
}

/** Read the renderer handover state straight from the live page. */
async function readRenderState(page: import("@playwright/test").Page): Promise<RenderState> {
  return page.evaluate(() => {
    const win = window as unknown as {
      game?: { scene?: { getScene?: (key: string) => unknown } };
    };
    const scene = win.game?.scene?.getScene?.("overworld") as
      | { cameras?: { main?: { visible?: boolean } }; world3d?: unknown }
      | null
      | undefined;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer="world3d"]');
    const sprite = document.querySelector<HTMLCanvasElement>(
      "#game-container > canvas:not([data-renderer])",
    );
    const hudLayer = document.getElementById("hud-layer");
    const box = (node: Element | null): RenderState["world3dBox"] => {
      if (node === null) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      world3dAttached: scene?.world3d !== null && scene?.world3d !== undefined,
      mainCameraVisible: scene?.cameras?.main?.visible ?? null,
      world3dCanvas:
        canvas === null ? null : { width: canvas.width, height: canvas.height },
      world3dBox: box(canvas),
      spriteBox: box(sprite),
      containerBox: box(document.getElementById("game-container")),
      hudLayerZ: hudLayer === null ? 0 : Number(getComputedStyle(hudLayer).zIndex),
      worldCanvasZ: canvas === null ? 0 : Number(getComputedStyle(canvas).zIndex),
    };
  });
}

/**
 * Sample the world canvas on a fixed grid and count distinct colours.
 *
 * A blank or single-texture-filled buffer collapses to a handful of values; a
 * drawn scene does not. The threshold is deliberately far below any real frame
 * so it flags "nothing was drawn", never "drawn differently".
 */
async function distinctCanvasColours(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer="world3d"]');
    if (canvas === null) return 0;
    const columns = 80;
    const rows = 45;
    const sample = document.createElement("canvas");
    sample.width = columns;
    sample.height = rows;
    const context = sample.getContext("2d");
    if (context === null) return 0;
    context.drawImage(canvas, 0, 0, columns, rows);
    const data = context.getImageData(0, 0, columns, rows).data;
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });
}

test.describe("3D world renderer", () => {
  test("?renderer=3d draws the world in WebGL and the HUD stays on top", async ({
    page,
  }) => {
    const collector = await bootToOverworld(page, { query: "renderer=3d" });
    await focusCanvas(page);
    await page.waitForTimeout(1_000);

    const state = await readRenderState(page);
    expect(state.world3dAttached).toBe(true);
    // The sprite camera stepped aside: it must not paint over the world canvas.
    expect(state.mainCameraVisible).toBe(false);
    expect(state.world3dCanvas).not.toBeNull();
    expect(state.world3dCanvas!.width).toBeGreaterThan(100);

    // The world canvas fills the window exactly, as the sprite canvas does.
    expect(state.containerBox).not.toBeNull();
    for (const surface of [state.world3dBox, state.spriteBox]) {
      expect(surface).not.toBeNull();
      expect(Math.abs(surface!.x - state.containerBox!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(surface!.y - state.containerBox!.y)).toBeLessThanOrEqual(1);
      expect(surface!.width).toBeGreaterThan(state.containerBox!.width * 0.98);
      expect(surface!.height).toBeGreaterThan(state.containerBox!.height * 0.98);
    }

    // HUD above the world: the canvas sits under #hud-layer, or a HUD card
    // would be painted over by the world.
    expect(state.worldCanvasZ).toBeLessThan(state.hudLayerZ);

    const colours = await distinctCanvasColours(page);
    expect(colours, `the world canvas drew only ${colours} distinct colours`).toBeGreaterThan(64);

    // The cast keeps its names in 3D: the tags are canvas textures built from the
    // entities' own text objects, so the village is inhabited by named figures
    // rather than anonymous art. Counted in the live scene graph, not asserted
    // from a screenshot — a tag can be drawn and still be invisible to a reader.
    const cast = await page.evaluate(() => {
      interface TexMesh {
        visible?: boolean;
        position?: { x?: number; y?: number; z?: number };
        scale?: { x?: number; y?: number };
        material?: { map?: { image?: unknown } | null; opacity?: number };
      }
      const win = window as unknown as {
        game?: { scene?: { getScene?: (key: string) => unknown } };
      };
      const scene = win.game?.scene?.getScene?.("overworld") as
        | {
            children?: { list: readonly { nameTag?: { text?: string } }[] };
            world3d?: unknown;
          }
        | null
        | undefined;
      const world = scene?.world3d as
        | { characters?: { root?: { children: readonly TexMesh[] } } }
        | undefined;
      const root = world?.characters?.root;
      if (root === undefined) return null;
      const isCanvasTexture = (map: unknown): boolean =>
        typeof map === "object" && map !== null && "isCanvasTexture" in map;
      const inkOf = (source: unknown): number => {
        if (!(source instanceof HTMLCanvasElement)) return -1;
        const probe = document.createElement("canvas");
        probe.width = source.width;
        probe.height = source.height;
        const context = probe.getContext("2d");
        if (context === null) return -1;
        context.drawImage(source, 0, 0);
        const data = context.getImageData(0, 0, probe.width, probe.height).data;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 8) ink += 1;
        return ink;
      };
      const tags = root.children.filter((child) => isCanvasTexture(child.material?.map));
      return {
        tagMeshes: tags.length,
        visibleTags: tags.filter((child) => child.visible === true).length,
        tagSizes: tags.map((child) => [child.scale?.x ?? 0, child.scale?.y ?? 0]),
        tagWidths: tags.map((child) => inkOf(child.material?.map?.image)),
        tagY: tags.map((child) => child.position?.y ?? 0),
        sceneChildren: scene?.children?.list.length ?? 0,
      };
    });
    console.log("CAST", JSON.stringify(cast));
    expect(cast).not.toBeNull();
    expect(cast!.sceneChildren).toBeGreaterThan(0);
    expect(cast!.tagMeshes, "no name tags reached the 3D frame").toBeGreaterThan(0);
    // Every tag found is shown — the ones that are not are shadows, which are
    // their own meshes and are checked by the world-canvas assertion above.
    expect(cast!.visibleTags).toBe(cast!.tagMeshes);
    // A tag whose canvas holds no pixels is invisible no matter how it is placed.
    for (const ink of cast!.tagWidths) expect(ink).toBeGreaterThan(0);

    // The player's own courier carries no name plate (it only hid the face):
    // nothing textured floats above the courier's own tile.
    const self = await page.evaluate(() => {
      interface TexMesh {
        position?: { x?: number; y?: number; z?: number };
        scale?: { x?: number; y?: number };
        material?: { map?: { image?: HTMLCanvasElement } | null };
      }
      const win = window as unknown as {
        game?: { scene?: { getScene?: (key: string) => unknown } };
      };
      const scene = win.game?.scene?.getScene?.("overworld") as
        | {
            player?: { x: number; y: number };
            world3d?: unknown;
          }
        | null
        | undefined;
      const world = scene?.world3d as
        | { characters?: { root?: { children: readonly TexMesh[] } } }
        | undefined;
      const root = world?.characters?.root;
      const player = scene?.player;
      if (root === undefined || player === undefined) return null;
      const tilePx = 48;
      const px = player.x / tilePx;
      const pz = player.y / tilePx;
      const near = root.children.find((child) => {
        const image = child.material?.map?.image;
        if (!(image instanceof HTMLCanvasElement)) return false;
        const x = child.position?.x ?? -999;
        const z = child.position?.z ?? -999;
        // Same tile, and off the ground: a tag floats above the figure where its
        // shadow lies flat on the floor, which is what tells the two apart.
        return (
          Math.abs(x - px) < 0.25 && Math.abs(z - pz) < 0.25 && (child.position?.y ?? 0) > 0.5
        );
      });
      return near === undefined ? null : { x: near.position?.x ?? 0, y: near.position?.y ?? 0 };
    });
    expect(self, "the courier's own name plate is hidden").toBeNull();

    await screenshot(page, "render-3d.png");
    collector.expectClean();
  });

  test("the shipped default draws the sprite world", async ({ page }) => {
    const collector = await bootToOverworld(page);
    await focusCanvas(page);

    const state = await readRenderState(page);
    expect(state.world3dAttached).toBe(false);
    expect(state.world3dCanvas).toBeNull();
    // The sprite camera is the frame again.
    expect(state.mainCameraVisible).toBe(true);
    expect(await page.locator(SEL.world3dCanvas).count()).toBe(0);
    expect(await page.locator(SEL.spriteCanvas).count()).toBe(1);

    await screenshot(page, "render-2d.png");
    collector.expectClean();
  });
});
