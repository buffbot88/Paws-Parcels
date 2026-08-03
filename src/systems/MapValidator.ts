import { TILES, TILE_INDEX } from "../game/Tiles.ts";
import { MAPS, MAP_DIMENSIONS, type MapData, type MapPoint } from "../game/Maps.ts";

export interface MapValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Shared map-validation rules (used by tests + the validate CLI):
 * dimensions match design/world-map.md, rows are rectangular with known tile
 * codes, spawn/transition tiles are inside bounds and walkable, and every
 * transition targets an existing zone with a valid spawn.
 */
export function validateMapData(map: MapData): MapValidationResult {
  const errors: string[] = [];
  const id = map.id;

  const expected = MAP_DIMENSIONS[id];
  if (expected) {
    if (map.width !== expected.width) {
      errors.push(`${id}: width ${map.width} != expected ${expected.width} (design/world-map.md)`);
    }
    if (map.height !== expected.height) {
      errors.push(`${id}: height ${map.height} != expected ${expected.height} (design/world-map.md)`);
    }
  }

  if (map.rows.length !== map.height) {
    errors.push(`${id}: row count ${map.rows.length} != height ${map.height}`);
  }
  map.rows.forEach((row, y) => {
    if (row.length !== map.width) {
      errors.push(`${id}: row ${y} has ${row.length} tiles, expected ${map.width}`);
    }
    for (let x = 0; x < row.length; x++) {
      if (!(row[x] in TILE_INDEX)) {
        errors.push(`${id}: unknown tile code "${row[x]}" at (${x},${y})`);
      }
    }
  });

  checkPoint(map, map.spawn, "spawn", errors);

  const seen = new Set<string>();
  for (const t of map.transitions) {
    if (seen.has(t.id)) errors.push(`${id}: duplicate transition id "${t.id}"`);
    seen.add(t.id);

    if (t.toZone === id) {
      errors.push(`${id}: transition "${t.id}" loops into its own zone`);
    }
    const target = MAPS[t.toZone];
    if (!target) {
      errors.push(`${id}: transition "${t.id}" targets unknown zone "${t.toZone}"`);
      continue;
    }
    checkPoint(map, t, `transition "${t.id}" trigger`, errors);
    checkPoint(target, t.spawn, `transition "${t.id}" spawn`, errors);
  }

  return { valid: errors.length === 0, errors };
}

function checkPoint(map: MapData, point: MapPoint, label: string, errors: string[]): void {
  if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) {
    errors.push(`${map.id}: ${label} (${point.x},${point.y}) is outside ${map.width}x${map.height}`);
    return;
  }
  // A point may land in rows that don't exist (row-count/short-row errors are
  // reported separately) — never crash on malformed shapes.
  const row = map.rows[point.y];
  if (row === undefined || point.x >= row.length) return;
  const code = row[point.x];
  const tile = TILES.find((t) => t.code === code);
  if (tile?.collides) {
    errors.push(`${map.id}: ${label} (${point.x},${point.y}) sits on a colliding tile ("${code}")`);
  }
}

export function validateAllMaps(): MapValidationResult {
  const errors: string[] = [];
  for (const map of Object.values(MAPS)) {
    errors.push(...validateMapData(map).errors);
  }
  return { valid: errors.length === 0, errors };
}
