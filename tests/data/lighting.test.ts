import { describe, expect, it } from "vitest";
import {
  LIGHT_DIRECTION,
  SHADOW_COLOR,
  shadowRecipe,
} from "../../src/game/lighting.ts";
import {
  CLOVER_VILLAGE_PROP_SIZING,
  HAPPY_VALLEY_PROP_SIZING,
  FOOTPRINT_FRACTION,
  PROP_BANDS,
  footprintWidthPx,
} from "../../src/game/propSizing.ts";
import { CloverVillageTextureKeys } from "../../src/game/cloverVillagePlacements.ts";
import { HappyValleyTextureKeys } from "../../src/game/happyValleyPlacements.ts";
import { DEPTH_OFFSET, foregroundDepth, isForegroundDepth, worldDepth } from "../../src/game/WorldDepth.ts";
import { FOREGROUND_DEPTH_BASE } from "../../src/game/WorldDepth.ts";

/**
 * Visual Pass 6 lighting audit, plus the Pass 5 depth bands.
 *
 * Both set-piece renderers used to bake their own shadow numbers: fixed 0.2
 * alpha, fixed `y - 4` offset, and a width of `frameWidth * scale * 0.7` clamped
 * to 320. So a bench and a building cast the same *shape* of shadow scaled up,
 * and the sign disagreed with the courier's own shadow (which sits 12px below the
 * sprite). These tests pin one recipe, derived from the same footprint helper the
 * composition clearance rule uses.
 */

const shape = (footprint: number) => shadowRecipe(footprint);

describe("lighting — one direction, one recipe", () => {
  it("holds the light in the north-west, so every shadow falls south-east", () => {
    expect(LIGHT_DIRECTION).toEqual({ x: -1, y: -1 });
    for (const footprint of [8, 20, 60, 200, 900]) {
      const recipe = shape(footprint);
      // Down and to the right of the base point: the shadow peeks out from under
      // the art rather than being tucked above its own bottom edge.
      expect(recipe.offsetXPx).toBeGreaterThan(0);
      expect(recipe.offsetYPx).toBeGreaterThan(0);
    }
  });

  it("scales the shadow with the ground contact, not with a fixed number", () => {
    const small = shape(10);
    const large = shape(400);
    expect(large.widthPx).toBeGreaterThan(small.widthPx * 10);
    expect(large.offsetXPx).toBeGreaterThan(small.offsetXPx);
    expect(large.offsetYPx).toBeGreaterThan(small.offsetYPx);
  });

  it("softens as the mass grows, so a building is not a black disc", () => {
    expect(shape(10).alpha).toBeGreaterThan(shape(400).alpha);
    // Within a restrained band: never invisible, never a hard blob.
    for (const footprint of [4, 40, 400, 5000]) {
      expect(shape(footprint).alpha).toBeGreaterThanOrEqual(0.15);
      expect(shape(footprint).alpha).toBeLessThanOrEqual(0.26);
    }
  });

  it("is deterministic and monotonic", () => {
    expect(shape(137)).toEqual(shape(137));
    let previous = 0;
    for (const footprint of [5, 15, 30, 60, 120, 240]) {
      const width = shape(footprint).widthPx;
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });

  it("clamps at both ends instead of vanishing or banding the screen", () => {
    expect(shape(0.1).widthPx).toBe(10);
    expect(shape(100000).widthPx).toBe(420);
    // A speck still gets a shadow worth drawing.
    expect(shape(0.1).heightPx).toBeGreaterThanOrEqual(4);
  });

  it("uses the world's own shading colour", () => {
    expect(SHADOW_COLOR).toBe(0x263b2a);
    expect(shape(50).color).toBe(SHADOW_COLOR);
  });
});

describe("lighting — the footprint that drives it", () => {
  it("gives every band a contact fraction between zero and one", () => {
    for (const [band, fraction] of Object.entries(FOOTPRINT_FRACTION)) {
      expect(fraction, band).toBeGreaterThan(0);
      expect(fraction, band).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(FOOTPRINT_FRACTION).sort()).toEqual(Object.keys(PROP_BANDS).sort());
  });

  it("treats a canopy as mostly overhang, unlike flat art", () => {
    expect(FOOTPRINT_FRACTION.canopy).toBeLessThan(FOOTPRINT_FRACTION.decal);
    expect(FOOTPRINT_FRACTION.canopy).toBeLessThan(FOOTPRINT_FRACTION.building);
  });

  it("derives a wider shadow for a building than for a tree of the same art width", () => {
    const tree = CLOVER_VILLAGE_PROP_SIZING[CloverVillageTextureKeys.tree]!;
    const postOffice = CLOVER_VILLAGE_PROP_SIZING[CloverVillageTextureKeys.postOffice]!;
    const treeShadow = shape(footprintWidthPx(tree, 0.42));
    const buildingShadow = shape(footprintWidthPx(postOffice, 0.6));
    expect(buildingShadow.widthPx).toBeGreaterThan(treeShadow.widthPx * 4);
    // The trunk-sized shadow is what keeps a tree from casting a canopy-wide disc.
    expect(treeShadow.widthPx).toBeLessThan(80);
  });

  it("covers every prop in both zones, so no piece falls back to a guess", () => {
    for (const sizing of [CLOVER_VILLAGE_PROP_SIZING, HAPPY_VALLEY_PROP_SIZING]) {
      for (const [key, spec] of Object.entries(sizing)) {
        expect(footprintWidthPx(spec, 0.5), key).toBeGreaterThan(0);
      }
    }
    // The valley's own pieces are in the table too.
    const stump = HAPPY_VALLEY_PROP_SIZING[HappyValleyTextureKeys.treeStumpShort]!;
    expect(footprintWidthPx(stump, 0.3)).toBeGreaterThan(0);
  });
});

describe("depth — named bands instead of magic offsets", () => {
  it("keeps the contact shadow under its piece and overlays above it", () => {
    expect(DEPTH_OFFSET.contactShadow).toBeLessThan(DEPTH_OFFSET.piece);
    expect(DEPTH_OFFSET.piece).toBeLessThan(DEPTH_OFFSET.overlay);
    // Small next to the whole-tile spacing of the world, so ordering is decided
    // by Y (what the player sees) and only nudged by the offset.
    expect(DEPTH_OFFSET.overlay - DEPTH_OFFSET.contactShadow).toBeLessThan(1);
  });

  it("sorts the world by Y", () => {
    expect(worldDepth(0)).toBeLessThan(worldDepth(48));
    expect(worldDepth(48)).toBeLessThan(worldDepth(96));
  });

  it("puts the foreground layer above every entity on every map", () => {
    // The tallest mapped zone is 75 tiles, so entity depth tops out around 76.
    const deepest = worldDepth(75 * 48 + 48, DEPTH_OFFSET.overlay);
    expect(deepest).toBeLessThan(FOREGROUND_DEPTH_BASE);
    expect(foregroundDepth(0)).toBeGreaterThan(deepest);
    expect(isForegroundDepth(foregroundDepth(0))).toBe(true);
    expect(isForegroundDepth(worldDepth(75 * 48))).toBe(false);
  });

  it("still Y-sorts the foreground pieces among themselves", () => {
    expect(foregroundDepth(100)).toBeLessThan(foregroundDepth(200));
    expect(foregroundDepth(200)).toBeGreaterThan(foregroundDepth(100));
  });
});
