import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLOVER_VILLAGE_PROP_SIZING,
  HAPPY_VALLEY_PROP_SIZING,
  PROP_BANDS,
  PROP_SIZE_TOLERANCE,
  PROP_TILE_PX,
  auditPlacements,
  renderedTiles,
  scaleForTiles,
  type PropSizing,
} from "../../src/game/propSizing.ts";
import {
  CloverVillageTextureKeys,
  getCloverVillageSetPieceDefinitions,
} from "../../src/game/cloverVillagePlacements.ts";
import {
  HappyValleyTextureKeys,
  getHappyValleySetPieceDefinitions,
} from "../../src/game/happyValleyPlacements.ts";

/**
 * Visual Pass 3 prop-scale audit.
 *
 * Before this, every placement carried a bare `scale:` literal and the entity
 * classes each picked their own (courier 1.33, NPC art 0.095, monsters 1.1), so
 * "the props don't feel like the same world" had no definition and no defence.
 * These tests give it both: a named band per texture key with an intended
 * rendered height in tiles, and a check that every placement honours it.
 *
 * The audit is what found the real defects, so it is worth keeping exact:
 * the greenery_1 tuft was drawn up to 4.65 tiles tall — taller than the canopy
 * trees and larger than the shop — while the trees themselves read at 3.1-3.5,
 * and the pond art appeared at four different sizes (2.13 to 3.42 tiles) from
 * the same file. All of those are corrected here and pinned below.
 */

const CLOVER_PLACEMENTS = getCloverVillageSetPieceDefinitions();
const VALLEY_PLACEMENTS = getHappyValleySetPieceDefinitions();

function pngSize(path: string): { w: number; h: number } {
  const header = fs.readFileSync(path).subarray(16, 24);
  return { w: header.readUInt32BE(0), h: header.readUInt32BE(4) };
}

/** Rendered heights (tiles) per texture key for a zone's non-frame placements. */
function heightsByKey(
  placements: readonly { texture: string; scale?: number; frame?: string }[],
  sizing: Readonly<Record<string, PropSizing>>,
): Map<string, number[]> {
  const byKey = new Map<string, number[]>();
  for (const placement of placements) {
    if (placement.frame !== undefined) continue;
    const spec = sizing[placement.texture];
    if (spec === undefined) continue;
    const list = byKey.get(placement.texture) ?? [];
    list.push(renderedTiles(spec.h, placement.scale ?? 1));
    byKey.set(placement.texture, list);
  }
  return byKey;
}

describe("prop sizing — the helper", () => {
  it("pins the tile grid it measures against", () => {
    // Kept as a local literal so this module stays Phaser-free (see the module
    // doc); a grid change must be a deliberate edit in both places.
    expect(PROP_TILE_PX).toBe(48);
  });

  it("converts source pixels and scale into rendered tiles", () => {
    expect(renderedTiles(48, 1)).toBe(1);
    expect(renderedTiles(96, 0.5)).toBe(1);
    expect(renderedTiles(620, 0.42)).toBeCloseTo(5.425, 3);
  });

  it("round-trips a scale through its rendered height", () => {
    for (const height of [0.4, 1.1, 2.6, 5.4, 10.4]) {
      expect(renderedTiles(620, scaleForTiles(620, height))).toBeCloseTo(height, 9);
    }
  });
});

describe("prop sizing — the table matches the art on disk", () => {
  it("declares a source size that matches each file's real header", () => {
    const problems: string[] = [];
    for (const [zone, sizing] of [
      ["clover village", CLOVER_VILLAGE_PROP_SIZING],
      ["happy valley", HAPPY_VALLEY_PROP_SIZING],
    ] as const) {
      for (const [key, spec] of Object.entries(sizing)) {
        if (!fs.existsSync(spec.path)) {
          problems.push(`${zone}: ${key} → missing ${spec.path}`);
          continue;
        }
        const actual = pngSize(spec.path);
        if (actual.w !== spec.w || actual.h !== spec.h) {
          problems.push(
            `${zone}: ${key} declares ${spec.w}x${spec.h} but ${spec.path} is ${actual.w}x${actual.h}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps a table row for every key the zone can draw", () => {
    // A texture key with no row cannot be audited at all, so the audit fails
    // rather than silently skipping it.
    const villageKeys = Object.values(CloverVillageTextureKeys);
    const sized = new Set(Object.keys(CLOVER_VILLAGE_PROP_SIZING));
    const unmapped = villageKeys.filter((key) => !sized.has(key));
    expect(unmapped).toEqual([]);

    const valleyKeys = Object.values(HappyValleyTextureKeys);
    const valleySized = new Set(Object.keys(HAPPY_VALLEY_PROP_SIZING));
    expect(valleyKeys.filter((key) => !valleySized.has(key))).toEqual([]);
  });

  it("keeps every declared intent inside its own band", () => {
    const problems: string[] = [];
    for (const [zone, sizing] of [
      ["clover village", CLOVER_VILLAGE_PROP_SIZING],
      ["happy valley", HAPPY_VALLEY_PROP_SIZING],
    ] as const) {
      for (const [key, spec] of Object.entries(sizing)) {
        const band = PROP_BANDS[spec.band];
        if (spec.tiles < band.min || spec.tiles > band.max) {
          problems.push(
            `${zone}: ${key} intends ${spec.tiles} tiles but declares band ${spec.band} (${band.min}-${band.max})`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("prop sizing — every placement honours its intent", () => {
  it("audits Clover Village clean", () => {
    expect(auditPlacements(CLOVER_PLACEMENTS, CLOVER_VILLAGE_PROP_SIZING)).toEqual([]);
  });

  it("audits Happy Valley clean", () => {
    expect(auditPlacements(VALLEY_PLACEMENTS, HAPPY_VALLEY_PROP_SIZING)).toEqual([]);
  });

  it("flags an undeclared key and a scale drift", () => {
    // The audit is only worth keeping if it actually fails: prove both failure
    // modes — a key with no sizing row at all, and a placement at the wrong
    // size — with synthetic input.
    const violations = auditPlacements(
      [
        { texture: "not-a-real-key", scale: 1 },
        { texture: CloverVillageTextureKeys.tree, scale: 0.1 },
        { texture: CloverVillageTextureKeys.tree, scale: 0.42 },
      ],
      CLOVER_VILLAGE_PROP_SIZING,
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]?.detail).toContain("no sizing declared");
    expect(violations[1]?.detail).toContain("intent");
  });

  it("skips terrain fills and sheet frames, which no scale describes", () => {
    // A terrain fill is drawn at one tile by the surface renderer, and a quest
    // item is a frame cut from a shared sheet; auditing either against its
    // texture's pixel height would report a defect that does not exist.
    expect(
      auditPlacements(
        [
          { texture: CloverVillageTextureKeys.ground, scale: 1.05 },
          { texture: CloverVillageTextureKeys.questItems, scale: 1.2, frame: "letterOpener" },
        ],
        CLOVER_VILLAGE_PROP_SIZING,
      ),
    ).toEqual([]);
  });

  it("keeps the same art from appearing at wildly different sizes", () => {
    // A single key whose placements straddle the tolerance is the defect the
    // audit exists to catch (the pond art used to span 2.13 to 3.42 tiles).
    const problems: string[] = [];
    for (const [zone, placements, sizing] of [
      ["clover village", CLOVER_PLACEMENTS, CLOVER_VILLAGE_PROP_SIZING],
      ["happy valley", VALLEY_PLACEMENTS, HAPPY_VALLEY_PROP_SIZING],
    ] as const) {
      for (const [key, heights] of heightsByKey(placements, sizing)) {
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        if ((max - min) / max > PROP_SIZE_TOLERANCE) {
          problems.push(`${zone}: ${key} spans ${min.toFixed(2)}-${max.toFixed(2)} tiles`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("prop sizing — the visual hierarchy", () => {
  const heights = heightsByKey(CLOVER_PLACEMENTS, CLOVER_VILLAGE_PROP_SIZING);
  const maxOf = (key: string): number => Math.max(...(heights.get(key) ?? [0]));

  it("keeps the Post Office the tallest thing in the village, by a clear margin", () => {
    const postOffice = maxOf(CloverVillageTextureKeys.postOffice);
    const others = [...heights.entries()]
      .filter(([key]) => key !== CloverVillageTextureKeys.postOffice)
      .map(([key, list]) => ({ key, tiles: Math.max(...list) }));
    const runnerUp = others.reduce((best, entry) => (entry.tiles > best.tiles ? entry : best));
    expect(postOffice).toBeGreaterThanOrEqual(9);
    // The reference composition puts the headquarters well above every shop and
    // cottage; a building that creeps up on it flattens the landmark.
    expect(postOffice / runnerUp.tiles).toBeGreaterThanOrEqual(1.6);
  });

  it("keeps the canopy above every shrub", () => {
    const canopy = Math.min(maxOf(CloverVillageTextureKeys.tree), maxOf(CloverVillageTextureKeys.treeAlt));
    for (const shrub of [
      CloverVillageTextureKeys.greenery,
      CloverVillageTextureKeys.greeneryAlt,
      CloverVillageTextureKeys.greeneryThird,
      CloverVillageTextureKeys.greeneryFourth,
      CloverVillageTextureKeys.greeneryFifth,
    ]) {
      expect(canopy).toBeGreaterThan(maxOf(shrub) * 1.4);
    }
  });

  it("keeps street furniture below the buildings", () => {
    const shortestBuilding = Math.min(
      maxOf(CloverVillageTextureKeys.shop),
      maxOf(CloverVillageTextureKeys.cafe),
      maxOf(CloverVillageTextureKeys.cottageNorthWest),
      maxOf(CloverVillageTextureKeys.cottageNorthEast),
    );
    for (const furniture of [
      CloverVillageTextureKeys.bench,
      CloverVillageTextureKeys.mailbox,
      CloverVillageTextureKeys.lampPost,
      CloverVillageTextureKeys.signpost,
      CloverVillageTextureKeys.questBoard,
      CloverVillageTextureKeys.fenceStraight,
    ]) {
      expect(maxOf(furniture)).toBeLessThan(shortestBuilding);
    }
  });

  it("keeps the courier able to read against both extremes", () => {
    // The courier renders one tile tall (36px class idle frames at 1.33). Every
    // band is anchored to that yardstick, so nothing may be smaller than a
    // quarter tile or the world loses its sense of scale.
    expect(renderedTiles(36, 1.33)).toBeCloseTo(1.0, 1);
    const smallest = Object.values(CLOVER_VILLAGE_PROP_SIZING).reduce((min, spec) =>
      spec.tiles < min.tiles ? spec : min,
    );
    expect(smallest.tiles).toBeGreaterThanOrEqual(PROP_BANDS.decal.min);
  });
});
