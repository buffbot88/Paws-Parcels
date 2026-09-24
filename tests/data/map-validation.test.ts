import { describe, expect, it } from "vitest";
import { MAPS, MAP_DIMENSIONS, type MapData, type MapPoint } from "../../src/game/Maps.ts";
import {
  isWalkableTile,
  sanitizeSpawn,
  validateAllMaps,
  validateMapData,
  validateNpcPlacement,
} from "../../src/systems/MapValidator.ts";
import { ZoneKeys } from "../../src/game/GameConstants.ts";
import npcsJson from "../../src/data/npcs.json";
import type { NPC } from "../../src/types/NPCtypes.ts";
import cloverVillageJson from "../../src/data/maps/clover-village.json";

// Compile-time schema conformance: renaming/removing/retyping any field of the
// shipped map JSON breaks typecheck (same pattern as the content tests). JSON
// imports widen string literals, so widen the interface unions first.
type Widen<T> = T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends readonly (infer U)[] ? Widen<U>[]
  : T extends object ? { [K in keyof T]: Widen<T[K]> }
  : T;

cloverVillageJson satisfies { interactables: Widen<MapData["interactables"]> } & Widen<Omit<MapData, "interactables">>;

function mapFixture(overrides: Partial<MapData>): MapData {
  return {
    id: "zone-test",
    name: "Test Zone",
    width: 3,
    height: 3,
    rows: ["GGG", "GPG", "GGG"],
    spawn: { x: 1, y: 1 },
    transitions: [],
    interactables: [],
    ...overrides,
  };
}

function interactableFixture(overrides: Partial<MapData["interactables"][number]> = {}) {
  return {
    id: "object-test",
    kind: "sign" as const,
    label: "Test Sign",
    x: 1,
    y: 1,
    lines: ["Hello!"],
    ...overrides,
  };
}

describe("map validation — shipped maps", () => {
  it("the hub zone matches the dimensions locked in design/world-map.md", () => {
    expect(MAP_DIMENSIONS[ZoneKeys.CloverVillage]).toEqual({ width: 75, height: 75 });
  });

  it("validates cleanly and matches the expected dimensions", () => {
    for (const map of Object.values(MAPS)) {
      const result = validateMapData(map);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(MAP_DIMENSIONS[map.id]).toEqual({ width: map.width, height: map.height });
    }
  });

  it("every transition targets a registered zone other than its own", () => {
    for (const map of Object.values(MAPS)) {
      for (const t of map.transitions) {
        expect(MAPS[t.toZone]).toBeDefined();
        expect(t.toZone).not.toBe(map.id);
      }
    }
  });

  it("shipped spawn and transition tiles are walkable", () => {
    for (const map of Object.values(MAPS)) {
      const result = validateMapData(map);
      expect(
        result.errors.some((e) => e.includes("colliding tile")),
      ).toBe(false);
    }
  });

  it("blocks every authored building footprint and keeps its door walkable", () => {
    const map = MAPS[ZoneKeys.CloverVillage];
    const buildings = [
      { name: "post-office", x0: 33, y0: 15, x1: 41, y1: 22, door: { x: 37, y: 23 } },
      { name: "cafe", x0: 15, y0: 25, x1: 19, y1: 28, door: { x: 17, y: 29 } },
      { name: "research-shop", x0: 51, y0: 22, x1: 56, y1: 26, door: { x: 54, y: 27 } },
      { name: "florist", x0: 55, y0: 35, x1: 59, y1: 38, door: { x: 57, y: 39 } },
      { name: "cottage-nw", x0: 14, y0: 43, x1: 16, y1: 46, door: { x: 15, y: 47 } },
      { name: "cottage-ne", x0: 55, y0: 45, x1: 57, y1: 47, door: { x: 56, y: 48 } },
    ];
    for (const b of buildings) {
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          expect(isWalkableTile(map, x, y), `${b.name} wall (${x},${y})`).toBe(false);
        }
      }
      expect(isWalkableTile(map, b.door.x, b.door.y), `${b.name} door`).toBe(true);
    }
  });

  it("ships the woodland landmark objects for the errand quests", () => {
    const map = MAPS[ZoneKeys.CloverVillage];
    const ids = new Set(map.interactables.map((o) => o.id));
    for (const id of [
      "object-hollow-oak",
      "object-rabbit-burrows",
      "object-pond-edge",
      "object-picnic-blanket",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe("map validation — rule coverage", () => {
  it("rejects row widths that don't match the declared width", () => {
    const map = mapFixture({ width: 3, rows: ["GGGG", "GPG", "GGG"] });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("row 0"))).toBe(true);
  });

  it("rejects a row count that doesn't match the declared height", () => {
    const map = mapFixture({ height: 3, rows: ["GGG", "GPG"] });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("row count 2"))).toBe(true);
  });

  it("rejects unknown tile codes", () => {
    const map = mapFixture({ rows: ["GGG", "G?G", "GGG"] });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown tile code "?"'))).toBe(true);
  });

  it("rejects a spawn outside the map bounds", () => {
    const map = mapFixture({ spawn: { x: 5, y: 5 } });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("outside 3x3"))).toBe(true);
  });

  it("rejects a spawn on a colliding tile", () => {
    const map = mapFixture({ rows: ["GGG", "GTT", "GGG"], spawn: { x: 1, y: 1 } });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("colliding tile"))).toBe(true);
  });

  it("rejects a transition into an unknown zone", () => {
    const map = mapFixture({
      transitions: [
        { id: "t1", label: "?", x: 1, y: 0, toZone: "zone-nope", spawn: { x: 1, y: 1 } },
      ],
    });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown zone "zone-nope"'))).toBe(true);
  });

  it("rejects a transition that loops into its own zone", () => {
    const map = mapFixture({
      transitions: [
        { id: "t1", label: "?", x: 1, y: 0, toZone: "zone-test", spawn: { x: 1, y: 1 } },
      ],
    });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("loops into its own zone"))).toBe(true);
  });

  it("rejects a transition spawn outside the target zone", () => {
    const map = mapFixture({
      transitions: [
        {
          id: "t1",
          label: "?",
          x: 1,
          y: 0,
          toZone: ZoneKeys.CloverVillage,
          spawn: { x: 80, y: 80 }, // clover village is now 75x75
        },
      ],
    });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("transition \"t1\" spawn"))).toBe(true);
  });

  it("rejects a transition trigger on a colliding tile", () => {
    const map = mapFixture({
      rows: ["TTT", "GPG", "GGG"],
      transitions: [
        {
          id: "t1",
          label: "?",
          x: 1,
          y: 0,
          toZone: ZoneKeys.CloverVillage,
          spawn: { x: 15, y: 13 },
        },
      ],
    });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("colliding tile"))).toBe(true);
  });

  it("rejects duplicate transition ids", () => {
    const map = mapFixture({
      transitions: [
        { id: "t1", label: "?", x: 1, y: 0, toZone: ZoneKeys.CloverVillage, spawn: { x: 15, y: 13 } },
        { id: "t1", label: "?", x: 2, y: 0, toZone: ZoneKeys.CloverVillage, spawn: { x: 15, y: 13 } },
      ],
    });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate transition id "t1"'))).toBe(true);
  });

  it("validateAllMaps passes on the shipped content", () => {
    const result = validateAllMaps();
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("does not crash when a spawn sits in rows missing due to a row-count error", () => {
    const map = mapFixture({ height: 3, rows: ["GGG", "GPG"], spawn: { x: 1, y: 2 } });
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("row count 2"))).toBe(true);
  });
});

describe("map validation — interactables", () => {
  it("accepts a walkable interactable", () => {
    const map = mapFixture({ interactables: [interactableFixture()] });
    expect(validateMapData(map).valid).toBe(true);
  });

  it("accepts a wall-mounted object with a walkable neighbor", () => {
    const map = mapFixture({
      rows: ["GGG", "GPG", "GGG"],
      interactables: [interactableFixture({ x: 1, y: 0, kind: "quest-board" })],
    });
    expect(validateMapData(map).valid).toBe(true);
  });

  it("rejects an interactable outside the map bounds", () => {
    const map = mapFixture({ interactables: [interactableFixture({ x: 9, y: 9 })] });
    const result = validateMapData(map);
    expect(result.errors.some((e) => e.includes("outside"))).toBe(true);
  });

  it("rejects an interactable with an unknown kind", () => {
    const map = mapFixture({ interactables: [interactableFixture({ kind: "cannon" as never })] });
    const result = validateMapData(map);
    expect(result.errors.some((e) => e.includes("unknown kind"))).toBe(true);
  });

  it("rejects an interactable with no flavor lines", () => {
    const map = mapFixture({ interactables: [interactableFixture({ lines: [] })] });
    const result = validateMapData(map);
    expect(result.errors.some((e) => e.includes("flavor line"))).toBe(true);
  });

  it("rejects duplicate interactable ids", () => {
    const map = mapFixture({
      interactables: [interactableFixture(), interactableFixture({ x: 2, y: 2 })],
    });
    const result = validateMapData(map);
    expect(result.errors.some((e) => e.includes("duplicate interactable id"))).toBe(true);
  });

  it("rejects an unreachable object walled off on all sides", () => {
    const map = mapFixture({
      rows: ["TTT", "TTT", "TTT"],
      interactables: [interactableFixture({ x: 1, y: 1, kind: "mailbox" })],
    });
    const result = validateMapData(map);
    expect(result.errors.some((e) => e.includes("unreachable"))).toBe(true);
  });
});

describe("sanitizeSpawn / isWalkableTile", () => {
  it("keeps a walkable spawn unchanged", () => {
    const map = mapFixture({ rows: ["GGG", "GPG", "GGG"], spawn: { x: 1, y: 1 } });
    expect(sanitizeSpawn(map, { x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
  });

  it("falls back to the map spawn for a colliding point", () => {
    const map = mapFixture({ rows: ["GGG", "GTT", "GGG"], spawn: { x: 1, y: 1 } });
    expect(sanitizeSpawn(map, { x: 2, y: 1 })).toEqual({ x: 1, y: 1 });
    expect(isWalkableTile(map, 2, 1)).toBe(false);
  });

  it("falls back to the map spawn for an out-of-bounds point", () => {
    const map = mapFixture({ spawn: { x: 1, y: 1 } });
    expect(sanitizeSpawn(map, { x: 9, y: 9 })).toEqual({ x: 1, y: 1 });
    expect(isWalkableTile(map, 9, 9)).toBe(false);
  });
});

describe("npc placement", () => {
  it("every shipped NPC is inside the compact 75x75 hub", () => {
    const npcs = npcsJson.npcs as NPC[];
    expect(npcs.every((npc) => npc.homeTile.x >= 0 && npc.homeTile.x < 75 && npc.homeTile.y >= 0 && npc.homeTile.y < 75)).toBe(true);
  });

  it("every shipped NPC stands on a non-colliding tile", () => {
    const npcs = npcsJson.npcs as NPC[];
    expect(validateNpcPlacement(npcs)).toEqual([]);
  });

  it("places Pip on the open plaza, clear of the flower bed that hid him", () => {
    const pip = (npcsJson.npcs as NPC[]).find((npc) => npc.id === "npc-pip");
    expect(pip?.homeTile).toEqual({ x: 35, y: 30 });
    expect(MAPS[ZoneKeys.CloverVillage].rows[30]?.[35]).toBe("P");
  });

  it("places Fern the stylist on the open plaza beside spawn", () => {
    const fern = (npcsJson.npcs as NPC[]).find((npc) => npc.id === "npc-fern");
    expect(fern?.homeTile).toEqual({ x: 40, y: 30 });
    expect(MAPS[ZoneKeys.CloverVillage].rows[30]?.[40]).toBe("P");
  });

  it("places Lumi on the research shop's front path", () => {
    const lumi = (npcsJson.npcs as NPC[]).find((npc) => npc.id === "npc-lumi");
    expect(lumi?.homeTile).toEqual({ x: 52, y: 28 });
    expect(MAPS[ZoneKeys.CloverVillage].rows[28]?.[52]).toBe("P");
  });

  it("places Biscuit on the café's front path", () => {
    const biscuit = (npcsJson.npcs as NPC[]).find((npc) => npc.id === "npc-biscuit");
    expect(biscuit?.homeTile).toEqual({ x: 19, y: 30 });
    expect(MAPS[ZoneKeys.CloverVillage].rows[30]?.[19]).toBe("P");
  });

  it("places Maple on the florist's front path", () => {
    const maple = (npcsJson.npcs as NPC[]).find((npc) => npc.id === "npc-maple");
    expect(maple?.homeTile).toEqual({ x: 56, y: 40 });
    expect(MAPS[ZoneKeys.CloverVillage].rows[40]?.[56]).toBe("P");
  });

  it("reports an NPC placed on a colliding tile", () => {
    const npcs = npcsJson.npcs as NPC[];
    const bad = [
      {
        ...npcs[0],
        id: "npc-bad",
        homeZone: "zone-clover-village",
        homeTile: { x: 0, y: 0 }, // outer tree boundary (T) remains colliding
      },
    ] as NPC[];
    const errors = validateNpcPlacement(bad);
    expect(errors.some((e) => e.includes("colliding tile"))).toBe(true);
  });

  it("reports an NPC with an unknown homeZone", () => {
    const npcs = npcsJson.npcs as NPC[];
    const bad = [
      {
        ...npcs[0],
        id: "npc-bad",
        homeZone: "zone-nowhere" as never,
      },
    ] as NPC[];
    expect(validateNpcPlacement(bad).some((e) => e.includes("unknown homeZone"))).toBe(true);
  });
});
