import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TILES } from "../../../src/game/Tiles.ts";

/**
 * Server-side zone geometry for movement validation. Reads the same custom
 * map JSON the client uses (src/data/maps/<zone>.json) so collision rules
 * match the rendered world. Zone ids are `zone-<mapId>` (e.g.
 * `zone-clover-village` → `clover-village.json`).
 */

/**
 * Tile codes that block movement — derived from the SAME catalog the client
 * renders and collides with (src/game/Tiles.ts), so a new colliding tile in a
 * city map can never silently desync server validation from client rendering.
 */
const COLLIDING_CODES = new Set(
  TILES.filter((t) => t.collides).map((t) => t.code),
);

export interface ZoneData {
  zoneId: string;
  width: number;
  height: number;
  /** True when the tile at (x, y) is in bounds and walkable. */
  isWalkable: (x: number, y: number) => boolean;
}

interface MapFile {
  width: number;
  height: number;
  rows: string[];
}

// Resolve relative to this module, never process.cwd() — the server must find
// the maps no matter where it is launched from.
const MAPS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/data/maps",
);

/** Load zone geometry for a zone id, or null when the map is unknown. */
export function loadZoneData(zoneId: string): ZoneData | null {
  const file = resolve(MAPS_DIR, `${zoneId.replace(/^zone-/, "")}.json`);
  let map: MapFile;
  try {
    map = JSON.parse(readFileSync(file, "utf8")) as MapFile;
  } catch {
    return null;
  }
  if (
    typeof map.width !== "number" ||
    typeof map.height !== "number" ||
    !Array.isArray(map.rows) ||
    map.rows.length !== map.height
  ) {
    return null;
  }
  return {
    zoneId,
    width: map.width,
    height: map.height,
    isWalkable: (x, y) => isWalkableTile(map, x, y),
  };
}

function isWalkableTile(map: MapFile, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const row = map.rows[y];
  if (row === undefined || x >= row.length) return false;
  const code = row[x];
  return code !== undefined && !COLLIDING_CODES.has(code);
}
