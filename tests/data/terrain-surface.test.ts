import { describe, expect, it } from "vitest";
import cloverVillageJson from "../../src/data/maps/clover-village.json";
import happyValleyJson from "../../src/data/maps/happy-valley.json";
import {
  CLOVER_VILLAGE_GROUND_KIT,
  CLOVER_VILLAGE_TERRAIN,
  CloverVillageTextureKeys,
} from "../../src/game/cloverVillagePlacements.ts";
import { HAPPY_VALLEY_TERRAIN, HappyValleyTextureKeys } from "../../src/game/happyValleyPlacements.ts";
import {
  FRINGE_CROP_PX,
  FRINGE_PIECE_PX,
  GRASS_COVER_CODES,
  buildTerrainPlan,
  fringeFrameRect,
  fringeSafeFlip,
  hash01,
  isPavedTile,
  tileCodeAt,
  type TerrainPlan,
} from "../../src/game/terrainSurface.ts";
import groundTopology from "../../design/assets/ground-topology-roles.json";
import type { MapData } from "../../src/game/Maps.ts";

/**
 * Visual Pass 2 terrain tests.
 *
 * The surface is generated from the map, so there is no hand-authored placement
 * list to review; these tests are the review. They pin the decisions that a
 * visual regression would otherwise only show up as "the ground looks wrong":
 *
 *   - the plan is byte-stable (coordinate hashing, never RNG state);
 *   - every paved tile is drawn exactly once, and the plaza is the disc the map
 *     generator draws rather than the old hardcoded rectangle;
 *   - every seam between grass and paving is treated, and a fringe's grass only
 *     ever sits on the grass side;
 *   - the wired kit pieces carry the compass roles the topology catalog
 *     verified — a north/south swap would be invisible to every other check.
 */

// The planner's own spacing guards, mirrored here as pins: a change to them
// changes how dense the world looks, so it should be a deliberate edit.
const PATCH_SPACING = 5;
const FOLIAGE_SPACING = 1.6;

const CLOVER = cloverVillageJson as unknown as MapData;
const VALLEY = happyValleyJson as unknown as MapData;

const cloverPlan: TerrainPlan = buildTerrainPlan(CLOVER, { foliageVariants: 7 });
const cloverPlanAgain: TerrainPlan = buildTerrainPlan(CLOVER, { foliageVariants: 7 });

function countCode(map: MapData, codes: string): number {
  let count = 0;
  for (const row of map.rows) {
    for (const ch of row) if (codes.includes(ch)) count += 1;
  }
  return count;
}

/**
 * Smallest distance between any two of `points`, via bucket hashing.
 *
 * The pairing rule is the planner's own spacing guard, and there are hundreds
 * of pieces; comparing every pair is quadratic and (with assertion overhead)
 * slow enough to trip a test timeout. Bucketing by the minimum spacing keeps it
 * linear and proves exactly the same thing.
 */
function minPairDistance(
  points: readonly { tileX: number; tileY: number }[],
  cell: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  const buckets = new Map<string, { tileX: number; tileY: number }[]>();
  for (const point of points) {
    const bx = Math.floor(point.tileX / cell);
    const by = Math.floor(point.tileY / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          best = Math.min(best, Math.hypot(point.tileX - other.tileX, point.tileY - other.tileY));
        }
      }
    }
    const key = `${bx},${by}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [point]);
    else bucket.push(point);
  }
  return best;
}

function pavedTiles(map: MapData): string[] {
  const tiles: string[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (isPavedTile(map, x, y)) tiles.push(`${x},${y}`);
    }
  }
  return tiles;
}

describe("terrain plan — determinism", () => {
  it("is byte-stable across builds (no RNG state anywhere)", () => {
    expect(cloverPlanAgain).toEqual(cloverPlan);
  });

  it("pins the coordinate hash, so a constant tweak is a visible diff", () => {
    // Not an aesthetic assertion — a tripwire. Every branch of the planner is
    // keyed off this function, so changing it silently reshuffles the whole
    // surface; a deliberate change must re-pin these values and re-review the
    // captures.
    expect(hash01(0, 0, 0)).toBe(0);
    expect(hash01(3, 5, 1)).toBeCloseTo(0.981056785909459, 12);
    expect(hash01(37, 28, 0x51ed)).toBeCloseTo(0.3309090929105878, 12);
  });

  it("returns values strictly inside [0, 1) across the village", () => {
    for (let y = 0; y < CLOVER.height; y += 1) {
      for (let x = 0; x < CLOVER.width; x += 1) {
        const v = hash01(x, y, 0x1234);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe("terrain plan — full surface coverage", () => {
  it("draws every path tile exactly once, as road or as plaza", () => {
    const drawn = [...cloverPlan.paths, ...cloverPlan.paved];
    const pathTiles = countCode(CLOVER, "P");
    expect(drawn.length).toBe(pathTiles);

    const unique = new Set(drawn.map((p) => `${p.tileX},${p.tileY}`));
    expect(unique.size).toBe(pathTiles);

    // And every drawn tile really is a `P` tile, so nothing is drawn off-route.
    for (const tile of drawn) {
      expect(tileCodeAt(CLOVER, tile.tileX, tile.tileY)).toBe("P");
    }
  });

  it("classifies the plaza as the generated disc, not the old rectangle", () => {
    const paved = pavedTiles(CLOVER);
    // The generator fills a disc of radius 7.6 around (37,28); its interior
    // carries grass islands, so the paved surface is 134 tiles. The previous
    // hardcoded rectangle (x29-44, y25-35) painted 176 tiles over it.
    expect(paved.length).toBe(134);

    // The old rectangle's corners paved grass; the disc does not reach them.
    for (const corner of ["29,25", "44,25", "29,35", "44,35"]) {
      expect(paved).not.toContain(corner);
    }

    // The rim belongs to the plaza. This is the regression that mattered: rim
    // tiles score below the density threshold, so a core-only test painted a
    // brown road outline around a grey plaza.
    for (const rim of ["30,29", "44,29", "35,35", "32,25", "42,31"]) {
      expect(paved).toContain(rim);
    }

    // The disc's outermost north row (y23) stays road. It is one tile thick, so
    // locally it is genuinely as thin as a corridor — and it is where the Post
    // Office road meets the square, so it reads as the road mouth there.
    for (const northEdge of ["34,23", "40,23"]) {
      expect(paved).not.toContain(northEdge);
      expect(tileCodeAt(CLOVER, Number(northEdge.split(",")[0]), 23)).toBe("P");
    }

    // The grass/flower island inside the plaza stays grass.
    expect(paved).not.toContain("37,28");
  });

  it("keeps every plaza tile on `P` and every paved tile inside the plaza band", () => {
    for (const tile of pavedTiles(CLOVER)) {
      const [x, y] = tile.split(",").map(Number) as [number, number];
      expect(tileCodeAt(CLOVER, x, y)).toBe("P");
      // 9.4 tiles from the generator centre covers the radius-7.6 disc plus the
      // one-tile rim growth; a paving bug far from the plaza fails here.
      expect(Math.hypot(x - 37, y - 28)).toBeLessThan(9.4);
    }
  });
});

describe("terrain plan — seams (no machine-straight grass/paving boundary)", () => {
  it("treats every paving side that meets grass", () => {
    const treated = new Set(cloverPlan.fringes.map((f) => `${f.tileX},${f.tileY}:${f.edge}`));
    let expected = 0;
    for (let y = 0; y < CLOVER.height; y += 1) {
      for (let x = 0; x < CLOVER.width; x += 1) {
        if (tileCodeAt(CLOVER, x, y) !== "P") continue;
        for (const [edge, dx, dy] of [
          ["n", 0, -1],
          ["s", 0, 1],
          ["w", -1, 0],
          ["e", 1, 0],
        ] as const) {
          const neighbour = tileCodeAt(CLOVER, x + dx, y + dy);
          if (neighbour === null || !GRASS_COVER_CODES.has(neighbour)) continue;
          expected += 1;
          expect(treated.has(`${x},${y}:${edge}`)).toBe(true);
        }
      }
    }
    expect(cloverPlan.fringes.length).toBe(expected);
    expect(expected).toBeGreaterThan(300);
  });

  it("hangs each fringe from the side its grass is actually on", () => {
    for (const fringe of cloverPlan.fringes) {
      const dx = fringe.edge === "w" ? -1 : fringe.edge === "e" ? 1 : 0;
      const dy = fringe.edge === "n" ? -1 : fringe.edge === "s" ? 1 : 0;
      // The anchor tile is paving and the anchor's fringe side is grass, so the
      // grass lip lies across the seam instead of inside the grass.
      expect(tileCodeAt(CLOVER, fringe.tileX, fringe.tileY)).toBe("P");
      expect(GRASS_COVER_CODES.has(tileCodeAt(CLOVER, fringe.tileX + dx, fringe.tileY + dy) ?? "")).toBe(
        true,
      );
    }
  });

  it("mirrors a fringe only on the axis that cannot move its grass", () => {
    expect(fringeSafeFlip("n")).toBe("x");
    expect(fringeSafeFlip("s")).toBe("x");
    expect(fringeSafeFlip("e")).toBe("y");
    expect(fringeSafeFlip("w")).toBe("y");
  });

  it("crops a full tile-sized square out of each 256px kit piece", () => {
    // A one-tile crop keeps the strip at 1:1 scale; drawing the whole 256px
    // piece over a 48px tile would minify it 5.3:1 and average the fuzz away.
    expect(FRINGE_CROP_PX).toBe(48);
    for (const edge of ["n", "s", "e", "w"] as const) {
      const rect = fringeFrameRect(edge);
      expect(rect.width).toBe(FRINGE_CROP_PX);
      expect(rect.height).toBe(FRINGE_CROP_PX);
      // The crop must sit inside the piece, on the side the strip lies.
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(FRINGE_PIECE_PX);
      expect(rect.y + rect.height).toBeLessThanOrEqual(FRINGE_PIECE_PX);
    }
    expect(fringeFrameRect("n").y).toBe(0);
    expect(fringeFrameRect("s").y).toBe(FRINGE_PIECE_PX - FRINGE_CROP_PX);
    expect(fringeFrameRect("w").x).toBe(0);
    expect(fringeFrameRect("e").x).toBe(FRINGE_PIECE_PX - FRINGE_CROP_PX);
  });
});

describe("terrain plan — grass islands and forest cover", () => {
  it("scatters grass islands only on grass tiles, clear of each other", () => {
    for (const patch of cloverPlan.patches) {
      const code = tileCodeAt(CLOVER, patch.tileX, patch.tileY);
      expect(code === null || !GRASS_COVER_CODES.has(code)).toBe(false);
      expect(patch.scale).toBeGreaterThan(0);
      expect(patch.variant).toBeLessThan(2);
    }
    expect(minPairDistance(cloverPlan.patches, PATCH_SPACING)).toBeGreaterThanOrEqual(
      PATCH_SPACING,
    );
  });

  it("covers the blocking tree mass densely enough to stay visibly solid", () => {
    const trees = countCode(CLOVER, "T");
    // The tree mass keeps drawing its procedural square for uncovered tiles, so
    // this is about the canopy reading as forest, not about collision. The
    // spacing rule must not thin it below a contiguous-looking mass.
    expect(cloverPlan.foliage.length).toBeGreaterThan(trees * 0.2);
    for (const piece of cloverPlan.foliage) {
      // Band scatter exists to cover the blocking tree mass; a framing cluster is
      // planted for composition, so it may stand on grass but never on paving.
      const code = tileCodeAt(CLOVER, piece.tileX, piece.tileY);
      if (piece.source === "band") expect(code).toBe("T");
      else expect(code).not.toBe("P");
      expect(piece.variant).toBeLessThan(7);
      // Canopy scale follows the shared band from Pass 3: the same tree art as
      // the authored set pieces, so the two layers must agree on tree height
      // (5.4 tiles, scale 0.36-0.53 for the 620px source).
      expect(piece.scale).toBeGreaterThan(0.35);
      expect(piece.scale).toBeLessThan(0.55);
    }
    // Band scatter obeys the scatter floor; a framing cluster is allowed to sit
    // tighter (CLUSTER_MIN_SPACING = 1.3), because an entrance arc is meant to
    // read as one planted group.
    const band = cloverPlan.foliage.filter((piece) => piece.source === "band");
    expect(minPairDistance(band, FOLIAGE_SPACING)).toBeGreaterThanOrEqual(FOLIAGE_SPACING);
    expect(minPairDistance(cloverPlan.foliage, 1.3)).toBeGreaterThanOrEqual(1.3);
  });
});

describe("terrain materials — wired kit roles match the verified catalog", () => {
  const catalogRoles = groundTopology.roles as Record<string, string>;
  const edgeKit = groundTopology.edgeKit as Record<string, string>;

  it("wires every fringe pair to a piece the catalog roles as that compass edge", () => {
    const expected: Readonly<Record<string, string>> = {
      [CloverVillageTextureKeys.fringeNorthA]: "edge-n",
      [CloverVillageTextureKeys.fringeNorthB]: "edge-n",
      [CloverVillageTextureKeys.fringeSouthA]: "edge-s",
      [CloverVillageTextureKeys.fringeSouthB]: "edge-s",
      [CloverVillageTextureKeys.fringeWestA]: "edge-w",
      [CloverVillageTextureKeys.fringeWestB]: "edge-w",
      [CloverVillageTextureKeys.fringeEastA]: "edge-e",
      [CloverVillageTextureKeys.fringeEastB]: "edge-e",
    };
    for (const [key, role] of Object.entries(expected)) {
      const file = CLOVER_VILLAGE_GROUND_KIT[key];
      expect(file).toBeDefined();
      expect(catalogRoles[file as string]).toBe(role);
      // The catalog's edge kit is the verified subset; a piece outside it has
      // no confirmed side and must not be wired as an edge.
      expect(edgeKit[file as string]).toBe(role);
    }
  });

  it("uses the base and island pieces for the base and patch", () => {
    expect(catalogRoles[CLOVER_VILLAGE_GROUND_KIT[CloverVillageTextureKeys.ground] as string]).toBe(
      "base-texture",
    );
    expect(catalogRoles[CLOVER_VILLAGE_GROUND_KIT[CloverVillageTextureKeys.grassPatch] as string]).toBe(
      "patch",
    );
  });

  it("leaves the unverified corner and compound pieces unwired", () => {
    const wired = new Set(Object.values(CLOVER_VILLAGE_GROUND_KIT));
    for (const [file, role] of Object.entries(catalogRoles)) {
      if (!role.includes("corner") && role !== "compound") continue;
      expect(wired.has(file)).toBe(false);
    }
  });

  it("wires both variants of every edge the planner can emit", () => {
    const edges = ["n", "s", "e", "w"] as const;
    for (const edge of edges) {
      const variants = CLOVER_VILLAGE_TERRAIN.fringes?.[edge];
      expect(variants).toHaveLength(2);
      expect(new Set(variants).size).toBe(2);
      // The planner only ever picks 0 or 1, so both must exist or a fringe
      // silently falls back to one piece.
      for (const variant of cloverPlan.fringes.filter((f) => f.edge === edge)) {
        expect(variant.variant === 0 || variant.variant === 1).toBe(true);
      }
    }
  });
});

describe("terrain materials — per-zone honesty", () => {
  it("gives Happy Valley no feature it has no art for", () => {
    expect(HAPPY_VALLEY_TERRAIN.base).toBe(HappyValleyTextureKeys.ground);
    expect(HAPPY_VALLEY_TERRAIN.path).toBe(HappyValleyTextureKeys.path);
    // No kit exists in the valley's pack, so these stay undefined and the
    // shared renderer draws no fringe, island or plaza there.
    expect(HAPPY_VALLEY_TERRAIN.patch).toBeUndefined();
    expect(HAPPY_VALLEY_TERRAIN.plaza).toBeUndefined();
    expect(HAPPY_VALLEY_TERRAIN.fringes).toBeUndefined();
    expect(HAPPY_VALLEY_TERRAIN.foliage).toBeUndefined();
  });

  it("keeps procedural squares for blocking codes with no authored cover", () => {
    // Clover Village covers its tree mass with authored canopy; water and walls
    // are deliberately left to the tile map, because an uncovered blocking tile
    // that paints nothing is an invisible wall.
    expect(CLOVER_VILLAGE_TERRAIN.coveredBlockingCodes).toEqual(["T"]);
    expect(CLOVER_VILLAGE_TERRAIN.coveredBlockingCodes).not.toContain("~");
    expect(CLOVER_VILLAGE_TERRAIN.coveredBlockingCodes).not.toContain("W");
    expect(HAPPY_VALLEY_TERRAIN.coveredBlockingCodes).toEqual([]);
  });

  it("plans both zones from the same code, and lets materials decide what draws", () => {
    const valleyPlan = buildTerrainPlan(VALLEY, { foliageVariants: 1 });
    // The valley's one-tile-wide lanes never form a plaza, so nothing is
    // classified as paving there.
    expect(valleyPlan.paved).toHaveLength(0);
    // The plan is produced regardless of available art: the valley has grass
    // islands and grass-adjacent seams to plan, and skipping them is a
    // materials decision taken by the renderer, not a planner special case.
    expect(valleyPlan.paths.length).toBe(countCode(VALLEY, "P"));
    expect(valleyPlan.paths.length).toBeGreaterThan(0);
    expect(valleyPlan.patches.length).toBeGreaterThan(0);
    expect(valleyPlan.fringes.length).toBeGreaterThan(0);
    expect(HAPPY_VALLEY_TERRAIN.patch).toBeUndefined();
    expect(HAPPY_VALLEY_TERRAIN.fringes).toBeUndefined();
  });

  it("only covers blocking codes that exist in the map", () => {
    for (const code of CLOVER_VILLAGE_TERRAIN.coveredBlockingCodes ?? []) {
      expect(countCode(CLOVER, code)).toBeGreaterThan(0);
    }
  });
});
