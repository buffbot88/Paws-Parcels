import { describe, expect, it } from "vitest";
import cloverVillageJson from "../../src/data/maps/clover-village.json";
import happyValleyJson from "../../src/data/maps/happy-valley.json";
import npcsJson from "../../src/data/npcs.json";
import {
  COMPOSITION_CELL,
  COMPOSITION_DEFAULTS,
  DENSITY_MULTIPLIER,
  RESERVED_RADIUS,
  TREE_LINE_BAND,
  buildDensityGrid,
  buildFramingClusters,
  compositionApproaches,
  densityAt,
  isReservedNear,
  isTreeLineTile,
  plazaApproaches,
  regionClassAt,
  reservedTilesFor,
} from "../../src/game/terrainComposition.ts";
import { COMPOSITION_BY_ZONE } from "../../src/game/compositionPlans.ts";
import {
  buildTerrainPlan,
  hash01,
  isPavedTile,
  tileCodeAt,
  type TerrainPlan,
} from "../../src/game/terrainSurface.ts";
import {
  CLOVER_VILLAGE_PROP_SIZING,
  HAPPY_VALLEY_PROP_SIZING,
  auditReservedClearance,
  coversTile,
  footprintBoxTiles,
  type PositionedPiece,
} from "../../src/game/propSizing.ts";
import {
  CLOVER_VILLAGE_TERRAIN,
  CloverVillageTextureKeys,
  getCloverVillageSetPieceDefinitions,
} from "../../src/game/cloverVillagePlacements.ts";
import { getHappyValleySetPieceDefinitions } from "../../src/game/happyValleyPlacements.ts";
import type { MapData } from "../../src/game/Maps.ts";

/**
 * Visual Pass 4 composition audit — density contrast, the treeline, framing
 * clusters at the plaza approaches, and the clearance rule that decoration never
 * sits on a tile the player acts on.
 *
 * The previous scatter rolled the same odds on every eligible tile, which is why
 * review called the world "sparse in some areas and cluttered in others": even
 * odds cannot compose a place. The measured contrast is now dense ~2.7x normal
 * ~2.5x light, with open bands at zero, and the treeline leaves no boundary gap
 * at all (max 1.41 tiles to the nearest canopy piece, against a 1.6 tile
 * spacing floor).
 */

type ZoneMap = MapData & {
  spawn: { x: number; y: number };
  transitions: { x: number; y: number }[];
  interactables: { x: number; y: number; id: string }[];
};

const CLOVER = cloverVillageJson as unknown as ZoneMap;
const VALLEY = happyValleyJson as unknown as ZoneMap;
const NPCS = npcsJson.npcs;

const RESERVED_CLOVER = reservedTilesFor(
  CLOVER,
  NPCS.filter((npc) => npc.homeZone === "zone-clover-village").map((npc) => npc.homeTile),
);
const RESERVED_VALLEY = reservedTilesFor(
  VALLEY,
  NPCS.filter((npc) => npc.homeZone === "zone-happy-valley").map((npc) => npc.homeTile),
);

/** The authored plans the two zones actually compose with (see compositionPlans.ts). */
const CLOVER_COMPOSITION = COMPOSITION_BY_ZONE["zone-clover-village"]!;
const VALLEY_COMPOSITION = COMPOSITION_BY_ZONE["zone-happy-valley"]!;

const CLOVER_OPTIONS = {
  foliageVariants: CLOVER_VILLAGE_TERRAIN.foliage?.length ?? 1,
  reserved: RESERVED_CLOVER,
  composition: CLOVER_COMPOSITION,
};
const CLOVER_PLAN: TerrainPlan = buildTerrainPlan(CLOVER, CLOVER_OPTIONS);

/**
 * Where the plaza is: the centroid of its paved tiles, exactly as the planner
 * computes it, so the approaches audited here are the approaches drawn.
 */
const PLAZA_CENTRE = (() => {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < CLOVER.height; y += 1) {
    for (let x = 0; x < CLOVER.width; x += 1) {
      if (!isPavedTile(CLOVER, x, y)) continue;
      sx += x;
      sy += y;
      count += 1;
    }
  }
  return { x: sx / count, y: sy / count };
})();

/** The ways into the village that the shipped plan frames. */
const CLOVER_APPROACHES = compositionApproaches(
  CLOVER_COMPOSITION,
  CLOVER,
  (x, y) => isPavedTile(CLOVER, x, y),
  PLAZA_CENTRE,
);

/** The canopy pieces the surface renderer actually draws. */
function drawnFoliage(plan: TerrainPlan): PositionedPiece[] {
  const keys = CLOVER_VILLAGE_TERRAIN.foliage ?? [];
  return plan.foliage.map((piece) => ({
    texture: keys[piece.variant % keys.length] ?? CloverVillageTextureKeys.tree,
    tileX: piece.tileX,
    // terrainAssets draws canopy with origin (0.5, 1) at the tile's bottom edge.
    baseTileY: piece.tileY + 1,
    scale: piece.scale,
  }));
}

/** The grass islands the surface renderer actually draws. */
function drawnPatches(plan: TerrainPlan): PositionedPiece[] {
  return plan.patches.map((patch) => ({
    texture: CloverVillageTextureKeys.grassPatch,
    tileX: patch.tileX,
    baseTileY: patch.tileY + 0.5,
    scale: patch.scale,
  }));
}

/**
 * Canopy pieces per tile in each band, over two denominators.
 *
 * Two deliberate restrictions. The treeline band is excluded because it is
 * forced dense by definition, so including it would measure the boundary rule
 * rather than the bands. And only *scattered* pieces count (`source: "band"`):
 * the framing arcs and the blocking-cover pass plant deliberately, so including
 * them would credit a band with planting that did not come from it.
 *
 * Per *map* tile is what a player sees — how much canopy stands per unit of
 * ground. Per eligible forest tile is how much of the woodland the band actually
 * filled, which is the measure the spacing floor caps.
 *
 * Measured on the shipped village plan, interior only: open 0.000, light 0.041,
 * normal 0.057, dense 0.074 per map tile; 0.187 / 0.304 / 0.363 per forest tile.
 */
function canopyDensity(plan: TerrainPlan, forestOnly: boolean) {
  const eligible: Record<string, number> = {};
  const pieces: Record<string, number> = {};
  for (let y = 0; y < CLOVER.height; y += 1) {
    for (let x = 0; x < CLOVER.width; x += 1) {
      if (isTreeLineTile(CLOVER, x, y)) continue;
      if (forestOnly && tileCodeAt(CLOVER, x, y) !== "T") continue;
      const key = String(densityAt(plan.density, x, y));
      eligible[key] = (eligible[key] ?? 0) + 1;
    }
  }
  for (const piece of plan.foliage) {
    if (piece.source !== "band") continue;
    if (isTreeLineTile(CLOVER, piece.tileX, piece.tileY)) continue;
    if (forestOnly && tileCodeAt(CLOVER, piece.tileX, piece.tileY) !== "T") continue;
    const key = String(densityAt(plan.density, piece.tileX, piece.tileY));
    pieces[key] = (pieces[key] ?? 0) + 1;
  }
  return (multiplier: number): number => {
    const key = String(multiplier);
    return (pieces[key] ?? 0) / Math.max(1, eligible[key] ?? 1);
  };
}

/** Rate at which grass islands appear, over the tiles that could carry one. */
function islandRate(plan: TerrainPlan) {
  const eligible: Record<string, number> = {};
  const pieces: Record<string, number> = {};
  for (let y = 0; y < CLOVER.height; y += 1) {
    for (let x = 0; x < CLOVER.width; x += 1) {
      const code = tileCodeAt(CLOVER, x, y);
      if (code === null || !"GBX".includes(code)) continue;
      const key = String(densityAt(plan.density, x, y));
      eligible[key] = (eligible[key] ?? 0) + 1;
    }
  }
  for (const patch of plan.patches) {
    const key = String(densityAt(plan.density, patch.tileX, patch.tileY));
    pieces[key] = (pieces[key] ?? 0) + 1;
  }
  return (multiplier: number): number => {
    const key = String(multiplier);
    return (pieces[key] ?? 0) / Math.max(1, eligible[key] ?? 1);
  };
}

const canopyRate = canopyDensity(CLOVER_PLAN, false);
const canopyForestRate = canopyDensity(CLOVER_PLAN, true);
const islands = islandRate(CLOVER_PLAN);

describe("composition — deliberate density bands", () => {
  it("is deterministic", () => {
    expect(buildTerrainPlan(CLOVER, CLOVER_OPTIONS)).toEqual(CLOVER_PLAN);
  });

  it("produces open ground and thicket rather than even scatter", () => {
    const counts = new Map<string, number>();
    for (const row of CLOVER_PLAN.density) {
      for (const cls of row) counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    const total = CLOVER.width * CLOVER.height;
    // Every class must be present in real quantity: a map that is nearly all
    // "normal" is the even scatter this pass replaced.
    for (const cls of ["open", "light", "normal", "dense"] as const) {
      expect(counts.get(cls) ?? 0).toBeGreaterThan(total * 0.05);
    }
    // Contrast, not noise: no class may dominate the map.
    for (const cls of ["open", "normal", "dense"] as const) {
      expect(counts.get(cls) ?? 0).toBeLessThan(total * 0.55);
    }
  });

  it("keeps neighbouring cells correlated, so bands form regions not speckle", () => {
    // Measured on the shared defaults, which is the seeded roll the village only
    // uses where its plan paints nothing. A per-tile independent roll would agree
    // about a quarter of the time.
    const grid = buildTerrainPlan(CLOVER, {
      ...CLOVER_OPTIONS,
      composition: COMPOSITION_DEFAULTS,
    }).density;
    let agree = 0;
    let compared = 0;
    const cells = Math.floor(CLOVER.width / COMPOSITION_CELL);
    for (let cy = 1; cy < cells; cy += 1) {
      for (let cx = 1; cx < cells; cx += 1) {
        const x = cx * COMPOSITION_CELL + 2;
        const y = cy * COMPOSITION_CELL + 2;
        compared += 1;
        if (densityAt(grid, x, y) === densityAt(grid, x - COMPOSITION_CELL, y)) agree += 1;
      }
    }
    expect(agree / compared).toBeGreaterThan(0.5);
  });

  it("lets an authored region decide the band outright, with no dice", () => {
    // Intent beats variation: inside a region the class is the authored one and
    // nothing else — except where a reserved tile wins first, which is safety
    // beating intent and is asserted separately below. This is the whole point of
    // moving composition into JSON, so it is checked over every tile, not sampled.
    let covered = 0;
    let overruled = 0;
    for (let y = 0; y < CLOVER.height; y += 1) {
      for (let x = 0; x < CLOVER.width; x += 1) {
        if (isTreeLineTile(CLOVER, x, y, CLOVER_COMPOSITION.treeline.band)) continue;
        const authored = regionClassAt(CLOVER_COMPOSITION, x, y);
        if (authored === null) continue;
        if (isReservedNear(RESERVED_CLOVER, x, y)) {
          overruled += 1;
          continue;
        }
        covered += 1;
        expect(densityAt(CLOVER_PLAN.density, x, y)).toBe(DENSITY_MULTIPLIER[authored]);
      }
    }
    // A plan whose regions cover almost nothing would pass vacuously, and a plan
    // that never overlaps the reserved set would leave the priority untested.
    const total = CLOVER.width * CLOVER.height;
    expect(covered / total).toBeGreaterThan(0.3);
    expect(overruled).toBeGreaterThan(0);
  });

  it("closes the canopy in proportion to the band", () => {
    const order = [
      DENSITY_MULTIPLIER.open,
      DENSITY_MULTIPLIER.light,
      DENSITY_MULTIPLIER.normal,
      DENSITY_MULTIPLIER.dense,
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(canopyRate(order[i]!)).toBeGreaterThan(canopyRate(order[i - 1]!));
    }
    // A clearing is a clearing: nothing scatters in the open band at all.
    expect(canopyRate(DENSITY_MULTIPLIER.open)).toBe(0);
    // The contrast is the point — dense ground carries several times the canopy of
    // a light band per unit of ground. It is not proportional to the band odds,
    // because the spacing floor caps the dense bands: that cap is what stops a
    // thicket closing into an unreadable wall, and it is why the ratio here is the
    // packing ratio rather than 4.25x.
    expect(canopyRate(DENSITY_MULTIPLIER.dense)).toBeGreaterThan(
      canopyRate(DENSITY_MULTIPLIER.light) * 1.5,
    );
    // Measured against the woodland each band actually has, dense ground is packed
    // near the spacing floor's own maximum (1 / 1.6^2) while light ground is nowhere
    // near it — so the band still decides how wooded a place feels, and the floor
    // still stops a thicket closing into an unreadable wall.
    const cap = 1 / (CLOVER_COMPOSITION.scatter.canopySpacing ** 2);
    expect(canopyForestRate(DENSITY_MULTIPLIER.dense)).toBeLessThanOrEqual(cap);
    expect(canopyForestRate(DENSITY_MULTIPLIER.dense)).toBeGreaterThan(
      canopyForestRate(DENSITY_MULTIPLIER.light) * 1.6,
    );
  });

  it("keeps grass islands out of open ground", () => {
    // Islands are spacing-limited — PATCH_MIN_SPACING caps them far below the
    // band odds — so the band does not show as a rate difference the way canopy
    // does, but an open band must still be empty.
    expect(islands(DENSITY_MULTIPLIER.open)).toBe(0);
    expect(CLOVER_PLAN.patches.length).toBeGreaterThan(0);
  });
});

describe("composition — tree lines defining the edges", () => {
  it("leaves no gap in the boundary treeline", () => {
    const placed = CLOVER_PLAN.foliage;
    let bandTiles = 0;
    let worstGap = 0;
    for (let y = 0; y < CLOVER.height; y += 1) {
      for (let x = 0; x < CLOVER.width; x += 1) {
        const inBand =
          x < TREE_LINE_BAND ||
          y < TREE_LINE_BAND ||
          x >= CLOVER.width - TREE_LINE_BAND ||
          y >= CLOVER.height - TREE_LINE_BAND;
        if (!inBand || tileCodeAt(CLOVER, x, y) !== "T") continue;
        bandTiles += 1;
        let nearest = Number.POSITIVE_INFINITY;
        for (const piece of placed) {
          nearest = Math.min(nearest, Math.hypot(piece.tileX - x, piece.tileY - y));
        }
        worstGap = Math.max(worstGap, nearest);
      }
    }
    expect(bandTiles).toBeGreaterThan(500);
    // The gap must stay inside the spacing floor, or the treeline has holes.
    expect(worstGap).toBeLessThanOrEqual(1.9);
  });

  it("closes the boundary more tightly than it closes the interior", () => {
    const coverRate = (inBand: boolean): number => {
      let trees = 0;
      let covered = 0;
      for (let y = 0; y < CLOVER.height; y += 1) {
        for (let x = 0; x < CLOVER.width; x += 1) {
          const isBand =
            x < TREE_LINE_BAND ||
            y < TREE_LINE_BAND ||
            x >= CLOVER.width - TREE_LINE_BAND ||
            y >= CLOVER.height - TREE_LINE_BAND;
          if (isBand !== inBand || tileCodeAt(CLOVER, x, y) !== "T") continue;
          trees += 1;
          const near = CLOVER_PLAN.foliage.some(
            (piece) => Math.hypot(piece.tileX - x, piece.tileY - y) <= 1.9,
          );
          if (near) covered += 1;
        }
      }
      return covered / Math.max(1, trees);
    };
    expect(coverRate(true)).toBeGreaterThan(coverRate(false));
  });
});

describe("composition — framing clusters at the plaza approaches", () => {
  const approaches = CLOVER_APPROACHES;
  const derived = plazaApproaches(CLOVER, (x, y) => isPavedTile(CLOVER, x, y), PLAZA_CENTRE);
  const clusters = CLOVER_PLAN.framingClusters;

  it("finds the real ways in, not the whole rim of the disc", () => {
    // The paved disc is ringed by one tile of road, so "a road tile touching
    // pavement" describes ~36 tiles all the way around. Requiring the corridor to
    // continue outward leaves the three genuine mouths: west, east, and the
    // southern gate.
    expect(derived).toHaveLength(3);
    for (const approach of derived) {
      const outward = tileCodeAt(
        CLOVER,
        approach.tile.x + Math.round(approach.outward.x) * 2,
        approach.tile.y + Math.round(approach.outward.y) * 2,
      );
      expect(outward).toBe("P");
    }
  });

  it("agrees with the map about where those mouths are", () => {
    // The authored entrances are the map's own mouths, written down by hand. If a
    // map regeneration moves the roads, this is what catches the plan drifting —
    // and `validateComposition` is what rejects it before it ships.
    expect(approaches.map((a) => `${a.tile.x},${a.tile.y}`)).toEqual(
      derived.map((a) => `${a.tile.x},${a.tile.y}`),
    );
    // Authored outward directions are compass steps, so the arcs sit square to
    // the route instead of tilted by the disc's centroid. That is the only
    // difference between the two, and it is deliberate.
    for (const approach of approaches) {
      const step = Math.abs(approach.outward.x) + Math.abs(approach.outward.y);
      expect(step).toBeCloseTo(1, 6);
    }
  });

  it("places its planting outside the paving and off the water", () => {
    expect(clusters.length).toBe(approaches.length);
    for (const cluster of clusters) {
      expect(cluster.tiles.length).toBeGreaterThanOrEqual(3);
      for (const tile of cluster.tiles) {
        const code = tileCodeAt(CLOVER, tile.x, tile.y);
        expect(code).not.toBe("P");
        expect(code).not.toBe("~");
      }
    }
  });

  it("is actually drawn, in full: cluster planting outranks the scatter", () => {
    // A deliberate arc must survive the spacing rule that governs the scatter,
    // so band pieces near it are dropped rather than the arc losing pieces.
    const foliageTiles = new Set(
      CLOVER_PLAN.foliage.map((piece) => `${piece.tileX},${piece.tileY}`),
    );
    for (const cluster of clusters) {
      for (const tile of cluster.tiles) {
        expect(foliageTiles.has(`${tile.x},${tile.y}`)).toBe(true);
      }
    }
    expect(CLOVER_PLAN.foliage.filter((piece) => piece.source === "cluster")).toHaveLength(
      clusters.reduce((sum, cluster) => sum + cluster.tiles.length, 0),
    );
  });

  it("leaves the approach corridor itself walkable", () => {
    for (const approach of approaches) {
      for (const piece of drawnFoliage(CLOVER_PLAN)) {
        const spec = CLOVER_VILLAGE_PROP_SIZING[piece.texture];
        if (spec === undefined) continue;
        expect(coversTile(spec, piece, approach.tile.x, approach.tile.y)).toBe(false);
      }
    }
  });

  it("needs a map with a plaza to frame at all — which is why the valley authors one", () => {
    const valleyApproaches = plazaApproaches(
      VALLEY,
      (x, y) => isPavedTile(VALLEY, x, y),
      { x: 20, y: 13 },
    );
    expect(valleyApproaches).toHaveLength(0);
    expect(buildFramingClusters(valleyApproaches)).toHaveLength(0);
    // Nothing about where the valley's ground opens or closes can be derived: it
    // has no paving at all, and just one lane. Its arrival is authored.
    const authored = compositionApproaches(
      VALLEY_COMPOSITION,
      VALLEY,
      (x, y) => isPavedTile(VALLEY, x, y),
      { x: 20, y: 13 },
    );
    expect(authored).toHaveLength(1);
    expect(buildFramingClusters(authored)[0]!.tiles.length).toBeGreaterThanOrEqual(3);
    expect(VALLEY_COMPOSITION.regions.length).toBeGreaterThan(0);
  });
});

describe("composition — the authored plan is what gets composed", () => {
  it("is not the defaults: a zone with a plan composes differently", () => {
    const fromDefaults = buildTerrainPlan(CLOVER, {
      ...CLOVER_OPTIONS,
      composition: COMPOSITION_DEFAULTS,
    });
    // The plaza region and the thickets are authored, and the treeline band plus
    // the cell size differ from the shared defaults in the valley, so the plan has
    // to change the outcome rather than restate it.
    expect(CLOVER_PLAN.density).not.toEqual(fromDefaults.density);
    expect(CLOVER_COMPOSITION).not.toEqual(COMPOSITION_DEFAULTS);
    expect(VALLEY_COMPOSITION).not.toEqual(COMPOSITION_DEFAULTS);
  });

  it("opens the plaza and thickens the places the plan calls thickets", () => {
    // Probes read straight out of the authored plan, so the assertion is about
    // what a designer wrote, not about what the hash happened to produce.
    const at = (x: number, y: number): number => densityAt(CLOVER_PLAN.density, x, y);
    expect(at(37, 29)).toBe(DENSITY_MULTIPLIER.open);
    expect(at(19, 17)).toBe(DENSITY_MULTIPLIER.dense);
    expect(at(21, 62)).toBe(DENSITY_MULTIPLIER.dense);
    expect(at(62, 20)).toBe(DENSITY_MULTIPLIER.light);
    // Away from the regions and the boundary the seeded roll still varies.
    const authored = new Set(CLOVER_COMPOSITION.regions.map((region) => String(region.class)));
    expect(authored).toEqual(new Set(["open", "light", "dense"]));
  });

  it("honours the plan's own cell size rather than a hard-coded one", () => {
    const coarse = buildTerrainPlan(CLOVER, {
      ...CLOVER_OPTIONS,
      composition: { ...COMPOSITION_DEFAULTS, cellTiles: 24 },
    });
    const fine = buildTerrainPlan(CLOVER, {
      ...CLOVER_OPTIONS,
      composition: { ...COMPOSITION_DEFAULTS, cellTiles: 4 },
    });
    expect(coarse.density).not.toEqual(fine.density);
    // Larger cells mean longer runs, so neighbouring tiles agree more often.
    const agreement = (grid: TerrainPlan["density"]): number => {
      let same = 0;
      let compared = 0;
      for (let y = 8; y < CLOVER.height - 8; y += 1) {
        for (let x = 8; x < CLOVER.width - 8; x += 1) {
          compared += 1;
          if (densityAt(grid, x, y) === densityAt(grid, x - 1, y)) same += 1;
        }
      }
      return same / compared;
    };
    expect(agreement(coarse.density)).toBeGreaterThan(agreement(fine.density));
  });

  it("keeps reserved tiles clear even where the plan paints a thicket", () => {
    // Safety beats intent: a region over an NPC's tile must not plant on it.
    const grid = buildDensityGrid(CLOVER, hash01, RESERVED_CLOVER, CLOVER_COMPOSITION);
    for (const tile of RESERVED_CLOVER) {
      expect(densityAt(grid, tile.x, tile.y)).toBe(DENSITY_MULTIPLIER.open);
    }
  });
});

describe("composition — decoration keeps off the tiles players act on", () => {
  it("clears a margin around every reserved tile", () => {
    for (const [zone, reserved] of [
      [CLOVER, RESERVED_CLOVER],
      [VALLEY, RESERVED_VALLEY],
    ] as const) {
      const grid = buildDensityGrid(zone, hash01, reserved);
      for (const tile of reserved) {
        for (let dy = -RESERVED_RADIUS; dy <= RESERVED_RADIUS; dy += 1) {
          for (let dx = -RESERVED_RADIUS; dx <= RESERVED_RADIUS; dx += 1) {
            const x = tile.x + dx;
            const y = tile.y + dy;
            if (x < 0 || y < 0 || x >= zone.width || y >= zone.height) continue;
            expect(densityAt(grid, x, y)).toBe(DENSITY_MULTIPLIER.open);
          }
        }
      }
      expect(isReservedNear(reserved, reserved[0]!.x, reserved[0]!.y)).toBe(true);
    }
  });

  it("never lets scattered art overlap an NPC, spawn, transition or interactable", () => {
    const scatter = [...drawnFoliage(CLOVER_PLAN), ...drawnPatches(CLOVER_PLAN)];
    expect(
      auditReservedClearance(scatter, CLOVER_VILLAGE_PROP_SIZING, RESERVED_CLOVER, [
        "npc",
        "spawn",
        "transition",
        "interactable",
      ]),
    ).toEqual([]);
  });

  it("never lets authored art overlap an NPC, the spawn or a transition", () => {
    // Interactables are excluded on purpose: dedicated art is *meant* to sit on
    // its own interactable, which the art-parity suite asserts separately.
    expect(
      auditReservedClearance(
        getCloverVillageSetPieceDefinitions() as PositionedPiece[],
        CLOVER_VILLAGE_PROP_SIZING,
        RESERVED_CLOVER,
        ["npc", "spawn", "transition"],
      ),
    ).toEqual([]);
    expect(
      auditReservedClearance(
        getHappyValleySetPieceDefinitions() as PositionedPiece[],
        HAPPY_VALLEY_PROP_SIZING,
        RESERVED_VALLEY,
        ["npc", "spawn", "transition"],
      ),
    ).toEqual([]);
  });

  it("describes the reserved set from the map and its NPCs", () => {
    const kinds = new Set(RESERVED_CLOVER.map((tile) => tile.kind));
    expect(kinds).toEqual(new Set(["npc", "spawn", "transition", "interactable"]));
    // Every clover-village NPC must be in the set — a zone mismatch would leave
    // one unprotected without failing anything else.
    for (const npc of NPCS.filter((entry) => entry.homeZone === "zone-clover-village")) {
      expect(
        RESERVED_CLOVER.some(
          (tile) => tile.x === npc.homeTile.x && tile.y === npc.homeTile.y && tile.kind === "npc",
        ),
      ).toBe(true);
    }
  });

  it("measures contact, not the whole bounding box", () => {
    // A tree's canopy legitimately overhangs the path; only its trunk is contact.
    const tree = CLOVER_VILLAGE_PROP_SIZING[CloverVillageTextureKeys.tree]!;
    const box = footprintBoxTiles(tree, 0.42);
    expect(box.back).toBeLessThan(1.2);
    expect(box.halfWidth).toBeLessThan(1.5);
    expect(box.front).toBeLessThan(0.5);
  });
});
