import { describe, expect, it } from "vitest";
import { ARCHIVED_MAPS } from "../../src/game/ArchivedMaps.ts";
import { ZoneKeys } from "../../src/game/GameConstants.ts";
import {
  COMPOSITION_BY_ZONE,
  COMPOSITION_PLAN_JSON,
  auditCompositionPlans,
} from "../../src/game/compositionPlans.ts";
import {
  COMPOSITION_DEFAULTS,
  DENSITY_CLASSES,
  buildDensityGrid,
  compositionApproaches,
  densityAt,
  parseComposition,
  regionClassAt,
  validateComposition,
  type ZoneComposition,
} from "../../src/game/terrainComposition.ts";
import { hash01, isPavedTile } from "../../src/game/terrainSurface.ts";
import type { MapData } from "../../src/game/Maps.ts";

/**
 * The composition plan spec — where a zone's clearings, thickets and framed
 * entrances are authored, instead of in planner constants.
 *
 * Two halves. The first is the contract a designer relies on: what a missing
 * field means, what a broken one does, and which mistakes are caught. The second
 * is the shipped files themselves, which is the half that fails when a map is
 * regenerated underneath a hand-written plan.
 */

/** A small map whose road, water and paving make the entrance checks meaningful. */
const FIXTURE: MapData = {
  id: "zone-fixture",
  width: 12,
  height: 12,
  spawn: { x: 2, y: 2 },
  rows: Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 12 }, (_, x) => {
      if (y === 6 && x >= 1 && x <= 10) return "P";
      if (x === 6 && y >= 6 && y <= 10) return "P";
      if (x === 0 || y === 0 || x === 11 || y === 11) return "T";
      return "G";
    }),
  ),
  transitions: [],
  interactables: [],
  monsterSpawns: [],
} as unknown as MapData;

/** A copy of the defaults with one field replaced, for focused cases. */
function variant(overrides: Partial<ZoneComposition>): ZoneComposition {
  return { ...COMPOSITION_DEFAULTS, ...overrides };
}

describe("composition plan — parsing", () => {
  it("fills in the shared defaults for a plan that authors nothing", () => {
    const { composition, errors } = parseComposition({}, "zone-x");
    expect(errors).toEqual([]);
    // The zone label is the caller's, because the file may not say.
    expect(composition).toEqual({ ...COMPOSITION_DEFAULTS, zone: "zone-x" });
    // A zone with no plan must compose exactly as every zone did before plans
    // existed, so the defaults have to be the old constants.
    expect(composition.cellTiles).toBe(COMPOSITION_DEFAULTS.cellTiles);
    expect(composition.entrances).toBeNull();
  });

  it("reads every field a plan can author", () => {
    const { composition, errors } = parseComposition(
      {
        version: 1,
        zone: "zone-x",
        cellTiles: 8,
        treeline: { band: 2, class: "light" },
        bands: { open: 0.1, light: 0.2, normal: 0.3, dense: 0.4 },
        regions: [
          {
            class: "dense",
            shape: "rect",
            center: { x: 4, y: 5 },
            radius: { x: 2, y: 3 },
            note: "the wood",
          },
        ],
        entrances: [{ tile: { x: 1, y: 2 }, outward: { x: 0, y: 1 }, radii: [2, 4], spread: 0.5 }],
        scatter: {
          canopyDensity: 0.5,
          canopySpacing: 2,
          clusterSpacing: 1,
          patchDensity: 0.1,
          patchSpacing: 3,
          patchClearance: 1,
        },
        blockingCover: { minHeightTiles: 3 },
      },
      "zone-x",
    );
    expect(errors).toEqual([]);
    expect(composition.cellTiles).toBe(8);
    expect(composition.treeline).toEqual({ band: 2, class: "light" });
    expect(composition.bands.dense).toBe(0.4);
    expect(composition.regions).toHaveLength(1);
    expect(composition.regions[0]!.note).toBe("the wood");
    expect(composition.entrances).toEqual([
      { tile: { x: 1, y: 2 }, outward: { x: 0, y: 1 }, radii: [2, 4], spread: 0.5 },
    ]);
    expect(composition.scatter.canopySpacing).toBe(2);
    expect(composition.blockingCover.minHeightTiles).toBe(3);
  });

  it("ignores keys it does not know, including the files' prose", () => {
    // The shipped plans carry a top-level "note" and per-entry notes; prose must
    // never be an error, or nobody will document a plan.
    const { errors } = parseComposition({ note: "why this plan looks like this" }, "zone-x");
    expect(errors).toEqual([]);
  });

  it("collects every problem rather than stopping at the first", () => {
    const { composition, errors } = parseComposition(
      {
        version: 99,
        zone: "zone-y",
        cellTiles: "many",
        treeline: { band: -1, class: "forest" },
        bands: { open: 0, light: 0, normal: 0, dense: Number.NaN },
        regions: [
          null,
          { class: "dense", shape: "triangle", center: { x: 1 }, radius: { x: 0, y: 0 } },
        ],
        entrances: 7,
        scatter: "none",
        blockingCover: { minHeightTiles: "thick" },
      },
      "zone-x",
    );
    // Every field is checked, and the list is the whole list: a designer editing a
    // plan wants all of it, not the first thing the parser tripped over.
    expect(errors).toEqual([
      "version 99 is not the supported version 1",
      'plan says zone "zone-y" but the file is for "zone-x"',
      'cellTiles must be a finite number, got "many"',
      'class must be one of open, light, normal, dense, got "forest"',
      "dense must be a finite number, got null",
      "scatter must be an object",
      'minHeightTiles must be a finite number, got "thick"',
      "regions[0] must be an object",
      'regions[1].shape must be "ellipse" or "rect", got "triangle"',
      "regions[1].center must be { x, y } tile coordinates",
      "regions[1].radius must be positive in both directions",
      "entrances must be an array or null",
    ]);
    // A finite-but-impossible band is not a parse error: reading and judging are
    // separate, so the treeline's -1 survives here and is caught below.
    expect(composition.treeline.band).toBe(-1);
    expect(validateComposition(composition, FIXTURE)).toEqual(
      expect.arrayContaining(["treeline.band must not be negative"]),
    );
  });

  it("falls back to the defaults rather than throwing on a broken plan", () => {
    for (const broken of [null, [], "plan", 42, true]) {
      const { composition, errors } = parseComposition(broken, "zone-x");
      expect(errors.length).toBeGreaterThan(0);
      expect(composition).toEqual({ ...COMPOSITION_DEFAULTS, zone: "zone-x" });
    }
  });

  it("labels a rejected field with the default, not with garbage", () => {
    const { composition, errors } = parseComposition({ cellTiles: -3, treeline: { class: "bog" } }, "zone-x");
    // A negative cell size is a finite number, so it parses and is then rejected
    // by `validateComposition` — that split is deliberate: parsing reads, checking
    // judges. The unknown class is a parse error and keeps the default.
    expect(errors).toContain('class must be one of open, light, normal, dense, got "bog"');
    expect(composition.treeline.class).toBe(COMPOSITION_DEFAULTS.treeline.class);
    expect(composition.cellTiles).toBe(-3);
    expect(validateComposition(composition, FIXTURE)).toEqual(
      expect.arrayContaining(["cellTiles must be at least 1"]),
    );
  });
});

describe("composition plan — regions are paint, in file order", () => {
  it("lets a later region carve an opening out of an earlier one", () => {
    const plan = variant({
      regions: [
        { class: "dense", shape: "rect", center: { x: 5, y: 5 }, radius: { x: 4, y: 4 } },
        { class: "open", shape: "ellipse", center: { x: 5, y: 5 }, radius: { x: 1, y: 1 } },
      ],
    });
    // A later region wins: the ellipse's opening is cut out of the rectangle.
    expect(regionClassAt(plan, 5, 5)).toBe("open");
    // The rectangle spans 5 +/- 4, so tile 8 is inside it and tile 9 is not
    // ((9.5 - 5) / 4 = 1.125).
    expect(regionClassAt(plan, 8, 5)).toBe("dense");
    expect(regionClassAt(plan, 5, 8)).toBe("dense");
    expect(regionClassAt(plan, 8, 8)).toBe("dense");
    expect(regionClassAt(plan, 9, 5)).toBeNull();
    expect(regionClassAt(plan, 10, 10)).toBeNull();
  });

  it("distinguishes a rect from the ellipse inscribed in it", () => {
    const rect = variant({
      regions: [{ class: "light", shape: "rect", center: { x: 5, y: 5 }, radius: { x: 3, y: 3 } }],
    });
    const ellipse = variant({
      regions: [{ class: "light", shape: "ellipse", center: { x: 5, y: 5 }, radius: { x: 3, y: 3 } }],
    });
    // A corner of the square is inside the rect and outside the ellipse:
    // (7.5-5)/3 = 0.833 on both axes, and 0.833^2 + 0.833^2 = 1.39 > 1.
    expect(regionClassAt(rect, 7, 7)).toBe("light");
    expect(regionClassAt(ellipse, 7, 7)).toBeNull();
    // Straight out along one axis it is inside both.
    expect(regionClassAt(rect, 7, 5)).toBe("light");
    expect(regionClassAt(ellipse, 7, 5)).toBe("light");
  });

  it("samples tile centres, so a region is symmetric about its centre", () => {
    // A tile belongs to a region when its *centre* does: tile x spans [x, x+1],
    // so the test is on x + 0.5. Centre 6.5 with a half-extent of 3 therefore
    // holds tile centres 3.5..9.5 — tiles 3 to 9, mirrored about tile 6, with the
    // range's own edge inclusive. A half-tile error would show up immediately as
    // an asymmetric set.
    const plan = variant({
      regions: [
        { class: "dense", shape: "ellipse", center: { x: 6.5, y: 6.5 }, radius: { x: 3, y: 3 } },
      ],
    });
    for (const x of [3, 4, 5, 6, 7, 8, 9]) {
      expect(regionClassAt(plan, x, 6)).toBe("dense");
      expect(regionClassAt(plan, 6, x)).toBe("dense");
    }
    expect(regionClassAt(plan, 2, 6)).toBeNull();
    expect(regionClassAt(plan, 10, 6)).toBeNull();
    // Mirrored pairs, which is the claim being pinned.
    for (const offset of [0, 1, 2, 3]) {
      expect(regionClassAt(plan, 6 - offset, 6)).toBe(regionClassAt(plan, 6 + offset, 6));
    }
  });

  it("applies a region through the density grid, not just in the lookup", () => {
    // A one-tile treeline, so the 12x12 fixture's boundary band does not swallow
    // the region and make this pass for the wrong reason.
    const plan = variant({
      treeline: { band: 1, class: "dense" },
      regions: [{ class: "open", shape: "rect", center: { x: 6, y: 6 }, radius: { x: 3, y: 3 } }],
    });
    const grid = buildDensityGrid(FIXTURE, hash01, [], plan);
    for (let y = 3; y <= 8; y += 1) {
      for (let x = 3; x <= 8; x += 1) {
        expect(densityAt(grid, x, y)).toBe(plan.bands.open);
      }
    }
    // Outside the region the boundary band and the seeded roll still apply.
    expect(densityAt(grid, 0, 0)).toBe(plan.bands[plan.treeline.class]);
    expect(densityAt(grid, 11, 11)).toBe(plan.bands[plan.treeline.class]);
    expect(densityAt(grid, 1, 1)).toBeDefined();
  });
});

describe("composition plan — entrances", () => {
  it("treats null as 'derive them from the map' and [] as 'frame nothing'", () => {
    const derived = buildDensityGrid(FIXTURE, hash01, [], variant({ entrances: null }));
    expect(derived.length).toBe(FIXTURE.height);
    expect(
      compositionApproaches(variant({ entrances: null }), FIXTURE, () => false, { x: 5, y: 5 }),
    ).toEqual([]);
    const none = variant({ entrances: [] });
    expect(compositionApproaches(none, FIXTURE, () => false, { x: 5, y: 5 })).toEqual([]);
    // The difference is that a zone with no paving can still author one.
    const authored = variant({
      entrances: [{ tile: { x: 6, y: 6 }, outward: { x: 0, y: 1 } }],
    });
    expect(compositionApproaches(authored, FIXTURE, () => false, { x: 5, y: 5 })).toEqual([
      { tile: { x: 6, y: 6 }, outward: { x: 0, y: 1 }, radii: undefined, spread: undefined },
    ]);
  });

  it("normalises an authored outward direction", () => {
    const plan = variant({ entrances: [{ tile: { x: 6, y: 6 }, outward: { x: 3, y: 4 } }] });
    const [approach] = compositionApproaches(plan, FIXTURE, () => false, { x: 6, y: 6 });
    expect(approach!.outward.x).toBeCloseTo(0.6, 6);
    expect(approach!.outward.y).toBeCloseTo(0.8, 6);
  });

  it("rejects an outward direction of nothing, an off-map tile and a bad arc", () => {
    const { composition, errors } = parseComposition(
      {
        entrances: [
          // (3,3) is grass: an entrance there is not a way in, which the road check
          // below reports (see `validateComposition`).
          { tile: { x: 3, y: 3 }, outward: { x: 0, y: 0 } },
          { tile: { x: 3, y: 3 }, outward: { x: 1, y: 0 }, radii: [2, -1] },
          { tile: { x: 3, y: 3 }, outward: { x: 1, y: 0 }, spread: 0 },
        ],
      },
      "zone-x",
    );
    const joined = errors.join("\n");
    expect(joined).toContain("outward must not be { 0, 0 }");
    expect(joined).toContain("radii must be an array of positive numbers");
    expect(joined).toContain("spread must be a positive number");
    // The rejected extras are dropped, and the entrance itself still parses.
    expect(composition.entrances![1]).toEqual({ tile: { x: 3, y: 3 }, outward: { x: 1, y: 0 } });
    expect(
      validateComposition(composition, FIXTURE, {
        isPath: (x, y) => isPavedTile(FIXTURE, x, y) || FIXTURE.rows[y]?.[x] === "P",
      }),
    ).toEqual(
      expect.arrayContaining([
        "entrances[0] (3,3) has no road or paving within 2 tiles — it is not a way in",
        "entrances[1] (3,3) has no road or paving within 2 tiles — it is not a way in",
        "entrances[2] (3,3) has no road or paving within 2 tiles — it is not a way in",
      ]),
    );
  });
});

describe("composition plan — validation against the map", () => {
  const isPath = (x: number, y: number): boolean => isPavedTile(FIXTURE, x, y) || FIXTURE.rows[y]?.[x] === "P";

  it("accepts the defaults on a real map", () => {
    // The defaults must be valid, or every zone without a plan would be rejected.
    expect(validateComposition(COMPOSITION_DEFAULTS, FIXTURE, { isPath })).toEqual([]);
  });

  it("rejects bands that are no longer ordered open to dense", () => {
    const plan = variant({ bands: { open: 0, light: 1.2, normal: 1, dense: 1.7 } });
    expect(validateComposition(plan, FIXTURE)).toEqual([
      "bands must not decrease from open to dense, got open 0, light 1.2, normal 1, dense 1.7",
    ]);
    expect(validateComposition(variant({ bands: { open: 0, light: -1, normal: 1, dense: 1 } }), FIXTURE))
      .toEqual(expect.arrayContaining(["bands must not be negative"]));
  });

  it("rejects a region that has drifted off the map, keeping one that only clips it", () => {
    const gone = variant({
      regions: [{ class: "dense", shape: "rect", center: { x: 90, y: 90 }, radius: { x: 3, y: 3 } }],
    });
    expect(validateComposition(gone, FIXTURE)).toEqual([
      "regions[0] (dense at 90,90) does not overlap the 12x12 map",
    ]);
    const clipping = variant({
      regions: [{ class: "dense", shape: "rect", center: { x: 11, y: 6 }, radius: { x: 3, y: 3 } }],
    });
    expect(validateComposition(clipping, FIXTURE)).toEqual([]);
  });

  it("rejects an entrance that is no longer a way in", () => {
    // This is the check that earns its keep after a map is regenerated: the arc
    // would otherwise be planted in a field, framing nothing.
    const inTheField = variant({
      entrances: [{ tile: { x: 3, y: 3 }, outward: { x: 0, y: 1 } }],
    });
    expect(validateComposition(inTheField, FIXTURE, { isPath })).toEqual([
      "entrances[0] (3,3) has no road or paving within 2 tiles — it is not a way in",
    ]);
    const onTheRoad = variant({
      entrances: [{ tile: { x: 3, y: 6 }, outward: { x: -1, y: 0 } }],
    });
    expect(validateComposition(onTheRoad, FIXTURE, { isPath })).toEqual([]);
  });

  it("rejects an entrance outside the map, and skips the road check for it", () => {
    const off = variant({ entrances: [{ tile: { x: 20, y: 6 }, outward: { x: 1, y: 0 } }] });
    const errors = validateComposition(off, FIXTURE, { isPath });
    expect(errors).toEqual(["entrances[0] (20,6) is outside the 12x12 map"]);
  });

  it("rejects a treeline that swallows the whole map", () => {
    const plan = variant({ treeline: { band: 6, class: "dense" } });
    expect(validateComposition(plan, FIXTURE)).toEqual([
      "treeline.band 6 covers the whole 12x12 map",
    ]);
  });

  it("rejects a cell size and a band that cannot mean anything", () => {
    expect(validateComposition(variant({ cellTiles: 0 }), FIXTURE)).toEqual([
      "cellTiles must be at least 1",
    ]);
    expect(validateComposition(variant({ treeline: { band: -1, class: "dense" } }), FIXTURE)).toEqual([
      "treeline.band must not be negative",
    ]);
  });
});

describe("composition plan — the plans that ship", () => {
  it("has a plan for every composed zone, and a map for every plan", () => {
    expect(Object.keys(COMPOSITION_PLAN_JSON).sort()).toEqual(
      [ZoneKeys.CloverVillage, ZoneKeys.HappyValley].sort(),
    );
    for (const zoneId of Object.keys(COMPOSITION_PLAN_JSON)) {
      expect(ARCHIVED_MAPS[zoneId]).toBeDefined();
      expect(COMPOSITION_BY_ZONE[zoneId]).toBeDefined();
    }
  });

  it("passes its own audit — this is the gate `npm run validate` runs", () => {
    expect(auditCompositionPlans()).toEqual([]);
  });

  it("is what the zones actually compose with, not the defaults", () => {
    for (const zoneId of Object.keys(COMPOSITION_PLAN_JSON)) {
      expect(COMPOSITION_BY_ZONE[zoneId]).not.toEqual(COMPOSITION_DEFAULTS);
      // Every class must still be a known one, and every band a real number.
      for (const cls of DENSITY_CLASSES) {
        expect(Number.isFinite(COMPOSITION_BY_ZONE[zoneId]!.bands[cls])).toBe(true);
      }
    }
  });

  it("keeps the village's authored entrances on the map's real road mouths", () => {
    const map = ARCHIVED_MAPS[ZoneKeys.CloverVillage]!;
    const plan = COMPOSITION_BY_ZONE[ZoneKeys.CloverVillage]!;
    const approaches = compositionApproaches(plan, map, (x, y) => isPavedTile(map, x, y), {
      x: 37,
      y: 29,
    });
    expect(approaches).toHaveLength(3);
    for (const approach of approaches) {
      // Two tiles outward along the route must still be road: that is what makes
      // it a mouth rather than a tile of the rim.
      const x = approach.tile.x + Math.round(approach.outward.x) * 2;
      const y = approach.tile.y + Math.round(approach.outward.y) * 2;
      expect(map.rows[y]?.[x]).toBe("P");
    }
  });

  it("authors the valley's one way in, which its map cannot derive", () => {
    const map = ARCHIVED_MAPS[ZoneKeys.HappyValley]!;
    const plan = COMPOSITION_BY_ZONE[ZoneKeys.HappyValley]!;
    expect(plan.entrances).toHaveLength(1);
    // No paving at all, so nothing would be framed without the authored entry.
    expect(compositionApproaches(plan, map, (x, y) => isPavedTile(map, x, y), { x: 20, y: 13 }))
      .toHaveLength(1);
    const [approach] = compositionApproaches(plan, map, (x, y) => isPavedTile(map, x, y), {
      x: 20,
      y: 13,
    });
    expect(map.rows[approach!.tile.y + 2]?.[approach!.tile.x]).toBe("P");
  });
});
