import { TILES, TILE_INDEX } from "../game/Tiles.ts";
import { ARCHIVED_MAPS, ARCHIVED_MAP_DIMENSIONS } from "../game/ArchivedMaps.ts";
import { PLAYABLE_MAPS, type InteractableKind, type MapData, type MapPoint } from "../game/Maps.ts";
import type { NPC } from "../types/NPCtypes.ts";
import { propBlockedTiles } from "../game/propCollision.ts";

/** Allowed interactable kinds (world-map.md `object-*` entries). */
const INTERACTABLE_KINDS: readonly string[] = [
  "counter",
  "quest-board",
  "mailbox",
  "shop",
  "sign",
] as const satisfies readonly InteractableKind[];

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

  const expected = ARCHIVED_MAP_DIMENSIONS[id];
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
    const target = ARCHIVED_MAPS[t.toZone];
    if (!target) {
      errors.push(`${id}: transition "${t.id}" targets unknown zone "${t.toZone}"`);
      continue;
    }
    checkPoint(map, t, `transition "${t.id}" trigger`, errors);
    checkPoint(target, t.spawn, `transition "${t.id}" spawn`, errors);
  }

  const seenSpawns = new Set<string>();
  for (const s of map.monsterSpawns ?? []) {
    if (seenSpawns.has(s.id)) errors.push(`${id}: duplicate monster spawn id "${s.id}"`);
    seenSpawns.add(s.id);
    if (!s.key.trim()) {
      errors.push(`${id}: monster spawn "${s.id}" is missing a key`);
    }
    if (s.x < 0 || s.y < 0 || s.x >= map.width || s.y >= map.height) {
      errors.push(`${id}: monster spawn "${s.id}" (${s.x},${s.y}) is outside ${map.width}x${map.height}`);
    } else if (tileCollides(map, s.x, s.y)) {
      errors.push(`${id}: monster spawn "${s.id}" (${s.x},${s.y}) sits on a colliding tile`);
    }
  }

  const seenObjects = new Set<string>();
  for (const o of map.interactables) {
    if (seenObjects.has(o.id)) errors.push(`${id}: duplicate interactable id "${o.id}"`);
    seenObjects.add(o.id);

    if (!INTERACTABLE_KINDS.includes(o.kind)) {
      errors.push(`${id}: interactable "${o.id}" has unknown kind "${o.kind}"`);
    }
    if (o.x < 0 || o.y < 0 || o.x >= map.width || o.y >= map.height) {
      errors.push(`${id}: interactable "${o.id}" (${o.x},${o.y}) is outside ${map.width}x${map.height}`);
    } else {
      // Objects may sit on walls (counter, wall-mounted boards) as long as the
      // player can stand on an orthogonally adjacent tile to interact.
      const reachable =
        !tileCollides(map, o.x, o.y) ||
        [
          [o.x - 1, o.y],
          [o.x + 1, o.y],
          [o.x, o.y - 1],
          [o.x, o.y + 1],
        ].some(([nx, ny]) => !tileCollides(map, nx, ny));
      if (!reachable) {
        errors.push(`${id}: interactable "${o.id}" (${o.x},${o.y}) is unreachable (no walkable neighbor)`);
      }
    }
    if (!Array.isArray(o.lines) || o.lines.length === 0 || o.lines.some((l) => !l.trim())) {
      errors.push(`${id}: interactable "${o.id}" must have at least one non-empty flavor line`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** True when the tile at (x,y) is in bounds and blocks movement. */
function tileCollides(map: MapData, x: number, y: number): boolean {
  const row = map.rows[y];
  if (row === undefined || x < 0 || x >= row.length) return true; // out of bounds = blocked
  const tile = TILES.find((t) => t.code === row[x]);
  return (tile?.collides ?? true) || propBlockedTiles(map.id).has(`${x},${y}`);
}

/** True when the tile at (x, y) is in bounds and walkable. */
export function isWalkableTile(map: MapData, x: number, y: number): boolean {
  return !tileCollides(map, x, y);
}

/**
 * A spawn point guaranteed to be in bounds and walkable — falls back to the
 * map's default spawn when the given point is colliding or out of bounds
 * (used by OverworldScene so stale saved positions never wedge the courier).
 */
export function sanitizeSpawn(map: MapData, spawn: MapPoint): MapPoint {
  return isWalkableTile(map, spawn.x, spawn.y) ? spawn : map.spawn;
}

/**
 * Validates that every NPC stands on a non-colliding tile of their home zone
 * (Phase 3: NPCs are placed at homeTile and must be reachable on foot).
 */
export function validateNpcPlacement(npcs: readonly NPC[]): string[] {
  if (Object.keys(PLAYABLE_MAPS).length === 0) return [];
  const errors: string[] = [];
  for (const npc of npcs) {
    const map = ARCHIVED_MAPS[npc.homeZone];
    if (!map) {
      errors.push(`npc ${npc.id}: unknown homeZone "${npc.homeZone}"`);
      continue;
    }
    if (tileCollides(map, npc.homeTile.x, npc.homeTile.y)) {
      errors.push(
        `npc ${npc.id}: homeTile (${npc.homeTile.x},${npc.homeTile.y}) sits on a colliding tile in ${npc.homeZone}`,
      );
    }
  }
  return errors;
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
  } else if (propBlockedTiles(map.id).has(`${point.x},${point.y}`)) {
    errors.push(`${map.id}: ${label} (${point.x},${point.y}) is blocked by a solid prop`);
  }
}

export function validateAllMaps(): MapValidationResult {
  const errors: string[] = [];
  for (const map of Object.values(ARCHIVED_MAPS)) {
    errors.push(...validateMapData(map).errors);
  }
  return { valid: errors.length === 0, errors };
}
