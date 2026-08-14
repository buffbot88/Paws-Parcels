import classesJson from "../../../src/data/classes.json" with { type: "json" };
import itemsJson from "../../../src/data/items.json" with { type: "json" };
import monstersJson from "../../../src/data/monsters.json" with { type: "json" };
import skillsJson from "../../../src/data/skills.json" with { type: "json" };
import zonesJson from "../../../src/data/zones.json" with { type: "json" };
import { getDb } from "../db/connection.ts";

type SqlRow = Record<string, unknown>;

type StaticItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  maxStack: number;
  icon: string;
  rarity?: string;
  value?: number;
};

/**
 * Materialize JSON catalogs into the existing relational lookup tables.
 *
 * The tables are runtime indexes for foreign keys and efficient queries; the
 * JSON files remain the only authored source. Upserts preserve numeric IDs so
 * player-owned rows and audit history remain valid across content reloads.
 */
export function syncStaticContent(): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    syncClasses();
    syncZones();
    syncItems();
    syncSkills();
    syncMonsters();
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }
}

function syncClasses(): void {
  const db = getDb();
  const statement = db.prepare(`INSERT INTO character_classes
    (key, display_name, animal, role, primary_resource, resource_max, resource_regen_per_sec, base_stats, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      display_name = excluded.display_name,
      animal = excluded.animal,
      role = excluded.role,
      primary_resource = excluded.primary_resource,
      resource_max = excluded.resource_max,
      resource_regen_per_sec = excluded.resource_regen_per_sec,
      base_stats = excluded.base_stats,
      description = excluded.description`);
  for (const cls of classesJson.classes) {
    statement.run(
      cls.key,
      cls.displayName,
      cls.animal,
      cls.role,
      cls.primaryResource,
      cls.resourceMax,
      cls.resourceRegenPerSec,
      JSON.stringify(cls.baseStats),
      cls.description,
    );
  }
}

function syncZones(): void {
  const db = getDb();
  const statement = db.prepare(`INSERT INTO zones
    (key, display_name, kind, map_data_id, width_tiles, height_tiles, default_spawn_x, default_spawn_y, max_players, is_safe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      display_name = excluded.display_name,
      kind = excluded.kind,
      map_data_id = excluded.map_data_id,
      width_tiles = excluded.width_tiles,
      height_tiles = excluded.height_tiles,
      default_spawn_x = excluded.default_spawn_x,
      default_spawn_y = excluded.default_spawn_y,
      max_players = excluded.max_players,
      is_safe = excluded.is_safe`);
  for (const zone of zonesJson.zones) {
    statement.run(
      zone.key,
      zone.displayName,
      zone.kind,
      zone.mapDataId,
      zone.widthTiles,
      zone.heightTiles,
      zone.defaultSpawn.x,
      zone.defaultSpawn.y,
      zone.maxPlayers,
      zone.isSafe ? 1 : 0,
    );
  }
}

function syncItems(): void {
  const db = getDb();
  const statement = db.prepare(`INSERT INTO item_definitions
    (key, name, description, category, max_stack, icon, rarity, value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      max_stack = excluded.max_stack,
      icon = excluded.icon,
      rarity = excluded.rarity,
      value = excluded.value`);
  for (const item of itemsJson.items as StaticItem[]) {
    statement.run(
      item.id,
      item.name,
      item.description,
      item.category,
      item.maxStack,
      item.icon,
      item.rarity ?? "common",
      item.value ?? 0,
    );
  }
}

function syncSkills(): void {
  const db = getDb();
  const statement = db.prepare(`INSERT INTO skill_definitions
    (skill_key, class_key, name, description, cost, required_level, prerequisite_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_key) DO UPDATE SET
      class_key = excluded.class_key,
      name = excluded.name,
      description = excluded.description,
      cost = excluded.cost,
      required_level = excluded.required_level,
      prerequisite_key = excluded.prerequisite_key`);
  for (const skill of skillsJson.skills) {
    statement.run(
      skill.skillKey,
      skill.classKey,
      skill.name,
      skill.description,
      skill.cost,
      skill.requiredLevel,
      skill.prerequisiteKey,
    );
  }
}

function syncMonsters(): void {
  const db = getDb();
  const zoneIds = new Map(
    (db.prepare("SELECT id, key FROM zones").all() as SqlRow[])
      .map((row) => [String(row.key), Number(row.id)] as const),
  );
  const statement = db.prepare(`INSERT INTO monster_definitions
    (key, display_name, zone_id, family_id, level_min, level_max, max_hp, attack, defense, speed,
     aggro_behavior, attack_behavior, loot_table, respawn_seconds, experience_reward)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      display_name = excluded.display_name,
      zone_id = excluded.zone_id,
      family_id = excluded.family_id,
      level_min = excluded.level_min,
      level_max = excluded.level_max,
      max_hp = excluded.max_hp,
      attack = excluded.attack,
      defense = excluded.defense,
      speed = excluded.speed,
      aggro_behavior = excluded.aggro_behavior,
      attack_behavior = excluded.attack_behavior,
      loot_table = excluded.loot_table,
      respawn_seconds = excluded.respawn_seconds,
      experience_reward = excluded.experience_reward`);
  for (const monster of monstersJson.monsters) {
    const zoneId = zoneIds.get(monster.zoneKey);
    if (zoneId === undefined) throw new Error(`Monster ${monster.key} references unknown zone ${monster.zoneKey}`);
    statement.run(
      monster.key,
      monster.displayName,
      zoneId,
      monster.familyId,
      monster.levelMin,
      monster.levelMax,
      monster.maxHp,
      monster.attack,
      monster.defense,
      monster.speed,
      monster.aggroBehavior,
      monster.attackBehavior,
      JSON.stringify(monster.lootTable),
      monster.respawnSeconds,
      monster.experienceReward,
    );
  }
}
