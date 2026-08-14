import { getDb } from "../db/connection.ts";

/** A row object as returned by node:sqlite (null | number | bigint | string). */
type SqlRow = Record<string, unknown>;

/** Class template row from the JSON-synchronized `character_classes` lookup table. */
export interface CharacterClassRow {
  id: number;
  key: string;
  display_name: string;
  animal: string;
  role: string;
  primary_resource: string;
  resource_max: number;
  resource_regen_per_sec: number;
  /** Parsed JSON from base_stats: hp, attack, defense, speed, crit_*. */
  base_stats: Record<string, number>;
  description: string | null;
}

/**
 * List the playable class catalog from the JSON-synchronized lookup table.
 * Used by the character-creation screen and by createCharacter validation.
 */
export async function getCharacterClasses(): Promise<CharacterClassRow[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, \`key\`, display_name, animal, \`role\`, primary_resource,
              resource_max, resource_regen_per_sec, base_stats, description
         FROM character_classes
        ORDER BY id ASC`,
    )
    .all() as SqlRow[];
  return rows.map(rowToClass);
}

/** Look up a single class template by its numeric id, or null. */
export async function getCharacterClassById(
  classId: number,
): Promise<CharacterClassRow | null> {
  const row = getDb()
    .prepare(
      `SELECT id, \`key\`, display_name, animal, \`role\`, primary_resource,
              resource_max, resource_regen_per_sec, base_stats, description
         FROM character_classes
        WHERE id = ?
        LIMIT 1`,
    )
    .get(classId) as SqlRow | undefined;
  return row === undefined ? null : rowToClass(row);
}

/** Shape the client sees in GET /api/classes (no internal columns). */
export function toPublicClass(c: CharacterClassRow): Record<string, unknown> {
  return {
    id: c.id,
    key: c.key,
    display_name: c.display_name,
    animal: c.animal,
    role: c.role,
    primary_resource: c.primary_resource,
    resource_max: c.resource_max,
    resource_regen_per_sec: c.resource_regen_per_sec,
    base_stats: c.base_stats,
    description: c.description,
  };
}

function rowToClass(row: SqlRow): CharacterClassRow {
  return {
    id: Number(row.id),
    key: String(row.key ?? ""),
    display_name: String(row.display_name ?? ""),
    animal: String(row.animal ?? ""),
    role: String(row.role ?? "Member"),
    primary_resource: String(row.primary_resource ?? "stamina"),
    resource_max: Number(row.resource_max ?? 100),
    resource_regen_per_sec: Number(row.resource_regen_per_sec ?? 5),
    base_stats: parseBaseStats(row.base_stats),
    description: row.description === null ? null : String(row.description),
  };
}

/** base_stats is a JSON column; tolerate NULL/malformed for robustness. */
function parseBaseStats(raw: unknown): Record<string, number> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
