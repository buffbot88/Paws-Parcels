import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COURIER_FALLBACK_SIZING,
  COURIER_SIZING,
  CREATURE_SIZING,
  ENTITY_BANDS,
  ENTITY_SIZE_TOLERANCE,
  VILLAGER_FALLBACK_SIZING,
  VILLAGER_SIZING,
  allEntitySizes,
  auditEntitySizing,
  courierSizing,
  entityContactBox,
  entityContactWidthPx,
  entityFeetOffsetPx,
  entityHeadOffsetPx,
  entityNameTagOffsetPx,
  entityScale,
  entityShadow,
  villagerSizing,
  type EntitySizeRow,
} from "../../src/game/entitySizing.ts";
import { PROP_TILE_PX } from "../../src/game/propSizing.ts";
import { decodePNG } from "../../scripts/lib/png.mjs";

/**
 * The entity size convention, audited against the art itself.
 *
 * Pass 3 gave props a declared height in tiles but left the three entity classes
 * on bare `setScale` literals — courier 1.33, authored NPC art 0.095, monsters
 * 1.1 — which on screen meant 0.75, 1.14 and 0.92 tiles of *figure*. Villagers
 * were 1.5x the courier standing beside them and monsters were barely taller,
 * with nothing in the repository saying which of those was intended.
 *
 * These tests give the cast the same treatment the props got, and go one step
 * further: rather than trusting the numbers in the table, they re-measure the
 * alpha bounds of the art on disk. A row whose figure no longer matches the art
 * fails here, which is what keeps the convention from decaying into another set
 * of literals.
 */

/** Alpha-bounds box of a PNG, measured the way the table declares it. */
function figureBox(file: string): { w: number; h: number; vw: number; vh: number; feet: number } {
  const { w, h, px } = decodePNG(file);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (px[(y * w + x) * 4 + 3]! <= 16) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { w, h, vw: x1 - x0 + 1, vh: y1 - y0 + 1, feet: y1 + 1 - h / 2 };
}

/** Every PNG under a directory, recursively. */
function pngs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pngs(full);
    return /\.png$/i.test(entry.name) ? [full] : [];
  });
}

/**
 * Every frame a courier class can show: the four idle rotations (the stance on
 * screen at rest) plus every walk/attack/death frame.
 *
 * Both are needed: an idle bear is 26px tall and a walking one 27px in the same
 * 36px frame, and the declared height has to bound what the player actually
 * sees. Measuring only the animations would describe a figure nobody stands
 * still in; measuring only the rotations would under-declare the walk.
 */
function courierFrames(classDir: string): string[] {
  const rotations = pngs(`${classDir}/rotations`);
  const animations = pngs(`${classDir}/animations`);
  expect(rotations.length, `${classDir}/rotations`).toBe(4);
  expect(animations.length, `${classDir}/animations`).toBeGreaterThan(0);
  return [...rotations, ...animations];
}

/** The frames of one NPC pack's idle animation. */
function npcIdleFrames(artDir: string): string[] {
  return fs
    .readdirSync(`${artDir}/PNG/Front/PNG Sequences/Idle`)
    .filter((name) => /\.png$/i.test(name))
    .map((name) => `${artDir}/PNG/Front/PNG Sequences/Idle/${name}`);
}

const CLASS_DIRS: Readonly<Record<string, string>> = {
  "bear-warrior": "reference/assets/Classes/Warrior/Idle",
  "cat-mage": "reference/assets/Classes/Mage/Idle",
  "fox-archer": "reference/assets/Classes/Archer/Idle",
};

/** Half a pixel of slack for the alpha threshold on an odd-sized canvas. */
const FEET_SLACK_PX = 0.5;

const NPC_DIRS: Readonly<Record<string, string>> = {
  artist: "reference/assets/maps/CloverVillage/NPC/Artist",
  astrologer: "reference/assets/maps/CloverVillage/NPC/Astrologer",
  citizen: "reference/assets/maps/CloverVillage/NPC/Citizen",
};

describe("entity sizing — the cast obeys one convention", () => {
  it("audits clean", () => {
    expect(auditEntitySizing()).toEqual([]);
  });

  it("catches a row that leaves its band, overflows its canvas, or floats", () => {
    // The audit has to be able to fail, or its verdict means nothing.
    const bad: EntitySizeRow[] = [
      {
        id: "test:too-tall",
        spec: { ...VILLAGER_SIZING.citizen, tiles: 4 },
      },
      {
        id: "test:clipped",
        spec: { ...VILLAGER_SIZING.citizen, visible: 900 },
      },
      {
        id: "test:feet-below-canvas",
        spec: { ...VILLAGER_SIZING.citizen, feet: 400 },
      },
      {
        id: "test:unrenderable",
        spec: { ...VILLAGER_SIZING.citizen, visible: 0 },
      },
      {
        id: "test:not-archived",
        spec: { ...VILLAGER_SIZING.citizen, path: "somewhere/else" },
      },
    ];
    const violations = auditEntitySizing(bad);
    expect(violations).toHaveLength(bad.length);
    expect(violations.join("\n")).toContain("outside the villager band");
    expect(violations.join("\n")).toContain("would be clipped");
    expect(violations.join("\n")).toContain("canvas half-height");
    expect(violations.join("\n")).toContain("which no scale can render");
    expect(violations.join("\n")).toContain("authored row must point at the art archive");
  });

  it("catches a cast that ranks wrongly", () => {
    const villageTooShort = allEntitySizes().map((row) =>
      row.id === "villager:citizen" ? { ...row, spec: { ...row.spec, tiles: 0.7 } } : row,
    );
    expect(auditEntitySizing(villageTooShort).join("\n")).toContain(
      "villagers must out-top the courier",
    );

    const monsterTooShort = allEntitySizes().map((row) =>
      row.id === "creature:placeholder" ? { ...row, spec: { ...row.spec, tiles: 0.5 } } : row,
    );
    expect(auditEntitySizing(monsterTooShort).join("\n")).toContain(
      "monsters must not be shorter than the courier",
    );
  });

  it("keeps the courier exactly where the camera and physics are tuned", () => {
    // The courier is the yardstick: this pass corrects the entities that
    // disagreed with it rather than moving the character the world is tuned
    // around, so the derived scale must reproduce the old 1.33 within 5%.
    for (const [classKey, spec] of Object.entries(COURIER_SIZING)) {
      expect(entityScale(spec)).toBeCloseTo(1.33, 1);
      expect(spec.tiles).toBe(0.75);
      expect(ENTITY_BANDS.courier.min).toBeLessThanOrEqual(spec.tiles);
      expect(ENTITY_BANDS.courier.max).toBeGreaterThanOrEqual(spec.tiles);
      expect(classKey).toMatch(/^(bear-warrior|cat-mage|fox-archer)$/);
    }
  });

  it("derives every scale from the table instead of declaring one", () => {
    for (const { id, spec } of allEntitySizes()) {
      // scale = tiles * TILE / figure — the one conversion, for every entity.
      const derived = (spec.tiles * PROP_TILE_PX) / spec.visible;
      expect(entityScale(spec), id).toBeCloseTo(derived, 6);
      const tiles = (spec.visible * entityScale(spec)) / PROP_TILE_PX;
      expect(Math.abs(tiles - spec.tiles) / spec.tiles, id).toBeLessThanOrEqual(
        ENTITY_SIZE_TOLERANCE,
      );
    }
  });

  it("measures the generated placeholder from its own geometry", () => {
    // The blob is code, not a file: a radius-20 circle centred in a 48px square.
    for (const spec of [COURIER_FALLBACK_SIZING, VILLAGER_FALLBACK_SIZING, CREATURE_SIZING]) {
      expect(spec.source).toBe("generated");
      expect(spec.canvas).toEqual({ w: 48, h: 48 });
      expect(spec.visible).toBe(40);
      expect(spec.feet).toBe(20);
    }
  });

  it("never lets a placeholder stand in at the wrong size", () => {
    // A fallback that is silently the wrong size only shows up when class art
    // fails to load — the worst moment to discover it.
    // Different source art, so different scale — the same *rendered* courier.
    const renderedTiles = (spec: { visible: number }) =>
      (spec.visible * entityScale(spec as never)) / PROP_TILE_PX;
    expect(renderedTiles(COURIER_FALLBACK_SIZING)).toBeCloseTo(
      renderedTiles(COURIER_SIZING["bear-warrior"]),
      2,
    );
    expect(VILLAGER_FALLBACK_SIZING.band).toBe("villager");
    expect(VILLAGER_FALLBACK_SIZING.tiles).toBe(VILLAGER_SIZING.citizen.tiles);
    expect(courierSizing("fox-archer", true)).toBe(COURIER_SIZING["fox-archer"]);
    expect(courierSizing("fox-archer", false)).toBe(COURIER_FALLBACK_SIZING);
    expect(villagerSizing(null)).toBe(VILLAGER_FALLBACK_SIZING);
    expect(villagerSizing("artist")).toBe(VILLAGER_SIZING.artist);
  });

  it("sizes every shadow from the entity's own contact, on one light direction", () => {
    const shadows = allEntitySizes().map((row) => entityShadow(row.spec));
    for (const [index, row] of allEntitySizes().entries()) {
      const recipe = shadows[index]!;
      // The Pass 6 recipe's whole point: light from the north-west means the
      // shadow falls south-east, and its size follows the footprint.
      expect(recipe.offsetXPx, row.id).toBeGreaterThan(0);
      expect(recipe.offsetYPx, row.id).toBeGreaterThan(0);
      expect(recipe.alpha, row.id).toBeGreaterThanOrEqual(0.15);
      expect(recipe.alpha, row.id).toBeLessThanOrEqual(0.26);
      expect(recipe.widthPx, row.id).toBeCloseTo(
        Math.max(10, Math.min(420, entityContactWidthPx(row.spec) * 0.9)),
        6,
      );
    }
    // A wider figure casts a wider shadow, within each family. Compared inside
    // a family on purpose: a bear is wider than a standing villager despite
    // being shorter, and the rule is about the footprint, not the height.
    expect(entityShadow(COURIER_SIZING["fox-archer"]).widthPx).toBeGreaterThan(
      entityShadow(COURIER_SIZING["bear-warrior"]).widthPx,
    );
    expect(entityShadow(VILLAGER_SIZING.artist).widthPx).toBeGreaterThan(
      entityShadow(VILLAGER_SIZING.citizen).widthPx,
    );
  });

  it("places feet, head and name tag from the figure rather than the canvas", () => {
    for (const { id, spec } of allEntitySizes()) {
      const scale = entityScale(spec);
      expect(entityFeetOffsetPx(spec), id).toBeCloseTo(spec.feet * scale, 6);
      expect(entityHeadOffsetPx(spec), id).toBeCloseTo(-(spec.visible - spec.feet) * scale, 6);
      // The tag sits above the head, i.e. further up than the head is tall.
      expect(entityNameTagOffsetPx(spec), id).toBeLessThan(entityHeadOffsetPx(spec));
      // And the head must be above the centre, or the figure is upside down.
      expect(entityHeadOffsetPx(spec), id).toBeLessThan(0);
    }
  });

  it("gives an entity a contact box on the tile it stands on", () => {
    // Reuses the prop contact box, so Pass 4's clearance rule can reason about
    // characters with the same concept it uses for props.
    for (const { id, spec } of allEntitySizes()) {
      const box = entityContactBox(spec);
      expect(box.halfWidth, id).toBeGreaterThan(0);
      expect(box.front, id).toBeCloseTo(0.3, 6);
      // A character occupies roughly the tile under it, not a whole neighbourhood.
      expect(box.halfWidth, id).toBeLessThan(1.5);
      expect(box.back, id).toBeLessThan(spec.tiles);
    }
  });
});

/**
 * The art checks decode a few hundred PNGs, which comfortably exceeds vitest's
 * 5s default when the whole suite runs in parallel. The work is bounded and
 * deterministic, so the timeout is raised rather than the assertions weakened.
 */
describe("entity sizing — checked against the art on disk", { timeout: 60_000 }, () => {
  it("declares the figure box the class art actually has", () => {
    for (const [classKey, spec] of Object.entries(COURIER_SIZING)) {
      const frames = courierFrames(CLASS_DIRS[classKey]!);
      expect(frames.length, classKey).toBeGreaterThan(0);
      const boxes = frames.map(figureBox);
      expect(new Set(boxes.map((box) => `${box.w}x${box.h}`)), classKey).toEqual(
        new Set([`${spec.canvas.w}x${spec.canvas.h}`]),
      );
      expect(Math.max(...boxes.map((box) => box.vh)), classKey).toBe(spec.visible);
      expect(Math.max(...boxes.map((box) => box.vw)), classKey).toBe(spec.visibleWidth);
      expect(Math.max(...boxes.map((box) => box.feet)), classKey).toBe(spec.feet);
    }
  });

  it("declares the figure box the NPC packs actually have", () => {
    for (const [art, spec] of Object.entries(VILLAGER_SIZING)) {
      const frames = npcIdleFrames(NPC_DIRS[art]!);
      expect(frames.length, art).toBeGreaterThan(0);
      const boxes = frames.map(figureBox);
      expect(boxes[0]!.w, art).toBe(spec.canvas.w);
      expect(boxes[0]!.h, art).toBe(spec.canvas.h);
      expect(Math.max(...boxes.map((box) => box.vh)), art).toBe(spec.visible);
      expect(Math.max(...boxes.map((box) => box.vw)), art).toBe(spec.visibleWidth);
      expect(Math.max(...boxes.map((box) => box.feet)), art).toBe(spec.feet);
      // The pack's canvas is mostly padding — the reason the rule had to be
      // written in figure terms, not canvas terms.
      expect(spec.visible / spec.canvas.h, art).toBeLessThan(0.95);
      expect(spec.visible / spec.canvas.h, art).toBeGreaterThan(0.7);
    }
  });

  it("keeps every entity source path real", () => {
    for (const { id, spec } of allEntitySizes()) {
      if (spec.source !== "authored") {
        expect(spec.path, id).toMatch(/^generated:/);
        continue;
      }
      expect(fs.existsSync(spec.path), `${id} -> ${spec.path}`).toBe(true);
    }
  });

  it("leaves no bare scale literal in the entity classes or the scene", () => {
    // The convention only holds if the literals stay gone: a `setScale(1.33)`
    // reappearing would silently opt an entity out of the audit.
    const files = [
      "src/entities/Player.ts",
      "src/entities/RemotePlayer.ts",
      "src/entities/NPC.ts",
      "src/entities/Monster.ts",
      "src/scenes/OverworldScene.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/setScale\(\s*[\d.]/);
      expect(source, file).not.toMatch(/PlayerShadow|player-shadow/);
    }
  });
});
