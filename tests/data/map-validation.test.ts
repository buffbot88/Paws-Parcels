import { describe, expect, it } from "vitest";
import { MAPS, MAP_DIMENSIONS, type MapData, type MapPoint } from "../../src/game/Maps.ts";
import { validateAllMaps, validateMapData } from "../../src/systems/MapValidator.ts";
import { ZoneKeys } from "../../src/game/GameConstants.ts";
import postOfficeJson from "../../src/data/maps/post-office.json";
import brambleJson from "../../src/data/maps/bramble-patch.json";

// Compile-time schema conformance: renaming/removing/retyping any field of the
// shipped map JSON breaks typecheck (same pattern as the content tests).
postOfficeJson satisfies MapData;
brambleJson satisfies MapData;

function mapFixture(overrides: Partial<MapData>): MapData {
  return {
    id: "zone-test",
    name: "Test Zone",
    width: 3,
    height: 3,
    rows: ["GGG", "GPG", "GGG"],
    spawn: { x: 1, y: 1 },
    transitions: [],
    ...overrides,
  };
}

describe("map validation — shipped maps", () => {
  it("both zones match the dimensions locked in design/world-map.md", () => {
    expect(MAP_DIMENSIONS[ZoneKeys.PostOffice]).toEqual({ width: 30, height: 20 });
    expect(MAP_DIMENSIONS[ZoneKeys.Bramble]).toEqual({ width: 40, height: 26 });
  });

  it("validates cleanly and matches the expected dimensions", () => {
    for (const map of Object.values(MAPS)) {
      const result = validateMapData(map);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(MAP_DIMENSIONS[map.id]).toEqual({ width: map.width, height: map.height });
    }
  });

  it("every transition targets the other shipped zone", () => {
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
          toZone: ZoneKeys.PostOffice,
          spawn: { x: 99, y: 99 },
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
          toZone: ZoneKeys.PostOffice,
          spawn: { x: 15, y: 14 },
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
        { id: "t1", label: "?", x: 1, y: 0, toZone: ZoneKeys.PostOffice, spawn: { x: 15, y: 14 } },
        { id: "t1", label: "?", x: 2, y: 0, toZone: ZoneKeys.PostOffice, spawn: { x: 15, y: 14 } },
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
