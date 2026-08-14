import { describe, expect, it } from "vitest";
import zonesJson from "../../src/data/zones.json" with { type: "json" };
import { loadZoneData } from "../../server/src/ws/zoneData.ts";
import { MAPS } from "../../src/game/Maps.ts";
import { TILES } from "../../src/game/Tiles.ts";

describe("loadZoneData — real map files", () => {
  it("loads every shipped zone with the map's dimensions", () => {
    for (const map of Object.values(MAPS)) {
      const zone = loadZoneData(map.id);
      expect(zone, map.id).not.toBeNull();
      expect(zone!.width).toBe(map.width);
      expect(zone!.height).toBe(map.height);
    }
  });

  it("server walkability matches client collision for every tile of every map", () => {
    // The whole point of deriving server collision from the shared TILES
    // catalog: a city map with a new colliding tile can never desync the
    // server's movement validation from what the client renders.
    for (const map of Object.values(MAPS)) {
      const zone = loadZoneData(map.id);
      expect(zone, map.id).not.toBeNull();
      map.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const code = row[x];
          const tile = TILES.find((t) => t.code === code);
          expect(tile, `${map.id} (${x},${y}) code "${code}"`).toBeDefined();
          expect(zone!.isWalkable(x, y), `${map.id} (${x},${y}) "${code}"`).toBe(
            tile!.collides === false,
          );
        }
      });
    }
  });

  it("treats out-of-bounds tiles as blocked", () => {
    const zone = loadZoneData("zone-clover-village");
    expect(zone!.isWalkable(-1, 0)).toBe(false);
    expect(zone!.isWalkable(0, -1)).toBe(false);
    expect(zone!.isWalkable(zone!.width, 0)).toBe(false);
    expect(zone!.isWalkable(0, zone!.height)).toBe(false);
  });

  it("returns null for an unknown zone", () => {
    expect(loadZoneData("zone-nowhere")).toBeNull();
  });
});

describe("JSON zone catalog vs client map registry", () => {
  it("every JSON zone exists in the client MAPS registry", () => {
    expect(zonesJson.zones.length).toBeGreaterThan(0);
    for (const zone of zonesJson.zones) {
      expect(MAPS[zone.key], `catalog zone "${zone.key}"`).toBeDefined();
    }
  });

  it("every client MAPS zone has JSON metadata", () => {
    for (const key of Object.keys(MAPS)) {
      expect(zonesJson.zones.some((zone) => zone.key === key), `MAPS zone "${key}"`).toBe(true);
    }
  });
});
