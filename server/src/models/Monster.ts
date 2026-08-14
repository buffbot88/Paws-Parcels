import { getDb } from "../db/connection.ts";

/** A row object as returned by node:sqlite (null | number | bigint | string). */
type SqlRow = Record<string, unknown>;

/** A loot-table entry (parsed from the monster_definitions JSON column). */
export interface MonsterLootEntry {
  key: string;
  chance: number;
  quantity: number;
}

/** Monster template from the JSON-synchronized `monster_definitions` lookup table. */
export interface MonsterDefinitionRow {
  id: number;
  key: string;
  display_name: string;
  zone_id: number;
  family_id: string | null;
  level_min: number;
  level_max: number;
  max_hp: number;
  attack: number;
  defense: number;
  speed: number;
  aggro_behavior: string;
  attack_behavior: string;
  loot_table: MonsterLootEntry[];
  respawn_seconds: number;
  experience_reward: number;
}

/**
 * Load every monster definition that spawns in the given zone key
 * (e.g. `zone-happy-valley`). Returns [] for safe/unknown zones.
 */
export async function getMonsterDefinitionsByZone(
  zoneKey: string,
): Promise<MonsterDefinitionRow[]> {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.\`key\`, m.display_name, m.zone_id, m.family_id,
              m.level_min, m.level_max, m.max_hp, m.attack, m.defense,
              m.speed, m.aggro_behavior, m.attack_behavior, m.loot_table,
              m.respawn_seconds, m.experience_reward
         FROM monster_definitions m
         JOIN zones z ON z.id = m.zone_id
        WHERE z.\`key\` = ?
        ORDER BY m.id ASC`,
    )
    .all(zoneKey) as SqlRow[];
  return rows.map(rowToMonster);
}

function rowToMonster(row: SqlRow): MonsterDefinitionRow {
  return {
    id: Number(row.id),
    key: String(row.key ?? ""),
    display_name: String(row.display_name ?? ""),
    zone_id: Number(row.zone_id ?? 0),
    family_id: row.family_id === null ? null : String(row.family_id),
    level_min: Number(row.level_min ?? 1),
    level_max: Number(row.level_max ?? 1),
    max_hp: Number(row.max_hp ?? 50),
    attack: Number(row.attack ?? 5),
    defense: Number(row.defense ?? 3),
    speed: Number(row.speed ?? 100),
    aggro_behavior: String(row.aggro_behavior ?? "passive"),
    attack_behavior: String(row.attack_behavior ?? "melee"),
    loot_table: parseLootTable(row.loot_table),
    respawn_seconds: Number(row.respawn_seconds ?? 30),
    experience_reward: Number(row.experience_reward ?? 10),
  };
}

/** loot_table is a JSON array of { key, chance, quantity } — tolerate junk. */
function parseLootTable(raw: unknown): MonsterLootEntry[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e) => ({
        key: String(e.key ?? ""),
        chance: Number(e.chance ?? 0),
        quantity: Number(e.quantity ?? 1),
      }))
      .filter((e) => e.key !== "" && Number.isFinite(e.chance));
  } catch {
    return [];
  }
}
