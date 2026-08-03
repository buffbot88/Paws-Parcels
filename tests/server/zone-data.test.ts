import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadZoneData } from "../../server/src/ws/zoneData.ts";
import { MAPS } from "../../src/game/Maps.ts";
import { TILES } from "../../src/game/Tiles.ts";

const SEED_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../server/src/migrations/002_seed_zones.sql",
);

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

describe("zones seed vs client map registry", () => {
  it("every zone seeded in 002_seed_zones.sql exists in the client MAPS registry", () => {
    const sql = readFileSync(SEED_SQL, "utf8");
    const seededKeys = [...sql.matchAll(/'zone-[a-z0-9-]+'/g)].map((m) =>
      m[0].slice(1, -1),
    );
    expect(seededKeys.length).toBeGreaterThan(0);
    for (const key of seededKeys) {
      expect(MAPS[key], `seed zone "${key}"`).toBeDefined();
    }
  });

  it("every client MAPS zone has a seed row (server can hand out spawns for it)", () => {
    const sql = readFileSync(SEED_SQL, "utf8");
    for (const key of Object.keys(MAPS)) {
      expect(sql, `MAPS zone "${key}"`).toContain(`'${key}'`);
    }
  });
});
