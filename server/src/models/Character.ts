import { getDb } from "../db/connection.ts";
import type { CharacterClassRow } from "./CharacterClass.ts";
import { getZoneByKey } from "./Zone.ts";
import { logger } from "../middleware/logger.ts";
import { auditInventoryEvent, getDerivedEquipmentStats, getEffectiveSlotCount, getInventoryState, type EquipmentStats } from "./Equipment.ts";
import { applyExperience } from "./leveling.ts";
import type { QuestProgression } from "./Quest.ts";
import { normalizeAppearance, type Appearance } from "../../../src/game/appearance.ts";
import { toClassKey } from "../../../src/game/classStats.ts";

type SqlRow = Record<string, unknown>;

export interface CharacterRow {
  id: number;
  account_id: number;
  class_id: number;
  name: string;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
  appearance: Record<string, unknown>;
}

export interface CharacterSessionRow {
  id: number;
  account_id: number;
  name: string;
  class_key: string;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
  appearance: Appearance;
}

export interface CharacterCombatStats {
  max_hp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  crit_chance: number;
  crit_multiplier: number;
  parcel_capacity: number;
  movement_bonus: number;
  fragile_protection: number;
  weather_protection: number;
  navigation_bonus: number;
}

export type CreateCharacterResult =
  | { ok: true; character: CharacterRow }
  | { ok: false; reason: "NAME_TAKEN" };

export interface CharacterProfile {
  character: Record<string, unknown>;
  class: Record<string, unknown>;
  stats: Record<string, number>;
  inventory: {
    slotCount: number;
    items: {
      instanceId: number;
      slot: number | null;
      quantity: number;
      key: string;
      name: string;
      description: string;
      category: string;
      rarity: string;
      icon: string | null;
      equippedSlot: string | null;
      equipmentSlot: string | null;
    }[];
  };
  equipment: {
    slot: string;
    itemInstanceId: number;
    itemKey: string;
    name: string;
    description: string;
    rarity: string;
    icon: string | null;
    itemStats: Record<string, number>;
    courierEffects: Record<string, number>;
  }[];
  derived: EquipmentStats;
  skills: {
    skillPoints: number;
    entries: {
      key: string;
      name: string;
      description: string;
      cost: number;
      requiredLevel: number;
      prerequisiteKey: string | null;
      unlocked: boolean;
    }[];
  };
}

export type UnlockSkillResult =
  | { ok: true; profile: CharacterProfile }
  | { ok: false; reason: "CHARACTER_NOT_FOUND" | "SKILL_NOT_FOUND" | "WRONG_CLASS" | "LEVEL_REQUIRED" | "PREREQUISITE_REQUIRED" | "NOT_ENOUGH_POINTS" | "ALREADY_UNLOCKED" };

export async function createCharacter(params: {
  accountId: number;
  name: string;
  classId: number;
  appearance: Appearance | Record<string, unknown>;
  cls: CharacterClassRow;
}): Promise<CreateCharacterResult> {
  const base = params.cls.base_stats;
  const maxHp = base.hp ?? 100;
  const resourceMax = params.cls.resource_max;
  const startZone = "zone-clover-village";
  const startZoneRow = await getZoneByKey(startZone);
  if (startZoneRow === null) logger.warn("createCharacter: start zone missing from zones table", { zone: startZone });
  const startX = startZoneRow?.default_spawn_x ?? 62;
  const startY = startZoneRow?.default_spawn_y ?? 65;

  const appearanceJson = JSON.stringify(params.appearance);
  const db = getDb();
  try {
    db.exec("BEGIN");
    const info = db.prepare(`INSERT INTO characters
      (account_id, class_id, name, appearance, zone_id, pos_x, pos_y, level, experience, stamps, hp, max_hp, resource_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?)`).run(
      params.accountId, params.classId, params.name, appearanceJson,
      startZone, startX, startY, maxHp, maxHp, resourceMax,
    );
    const characterId = Number(info.lastInsertRowid);
    const res = params.cls.primary_resource === "mana"
      ? { maxCol: "mana_max", regenCol: "mana_regen" }
      : params.cls.primary_resource === "focus"
        ? { maxCol: "focus_max", regenCol: "focus_regen" }
        : { maxCol: "stamina_max", regenCol: "stamina_regen" };
    db.prepare(`INSERT INTO character_stats
      (character_id, attack, defense, speed, crit_chance, crit_multiplier, ${res.maxCol}, ${res.regenCol})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      characterId, base.attack ?? 10, base.defense ?? 5, base.speed ?? 180,
      base.critChance ?? base.crit_chance ?? 5, base.critMultiplier ?? base.crit_multiplier ?? 1.5,
      resourceMax, params.cls.resource_regen_per_sec,
    );
    db.prepare("INSERT INTO inventories (character_id, slot_count) VALUES (?, 12)").run(characterId);
    db.exec("COMMIT");
    return { ok: true, character: { id: characterId, account_id: params.accountId, class_id: params.classId, name: params.name, zone_id: startZone, pos_x: startX, pos_y: startY, level: 1, appearance: parseJsonObject(appearanceJson) } };
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (rollbackErr) { logger.error("createCharacter: rollback failed", { error: String(rollbackErr) }); }
    if (isUniqueConstraintError(err)) return { ok: false, reason: "NAME_TAKEN" };
    throw err;
  }
}

export function toPublicCharacter(c: CharacterRow): Record<string, unknown> {
  return { id: c.id, name: c.name, class_id: c.class_id, zone_id: c.zone_id, pos_x: c.pos_x, pos_y: c.pos_y, level: c.level, appearance: c.appearance };
}

function isUniqueConstraintError(err: unknown): boolean {
  return String(err).includes("UNIQUE constraint failed");
}

export async function getCharactersByAccountId(accountId: number): Promise<CharacterRow[]> {
  const rows = getDb().prepare(`SELECT id, account_id, class_id, name, zone_id, pos_x, pos_y, level, appearance FROM characters WHERE account_id = ? ORDER BY id ASC`).all(accountId) as SqlRow[];
  return rows.map(rowToCharacter);
}

export async function getCharacterById(characterId: number): Promise<CharacterRow | null> {
  const row = getDb().prepare(`SELECT id, account_id, class_id, name, zone_id, pos_x, pos_y, level, appearance FROM characters WHERE id = ? LIMIT 1`).get(characterId) as SqlRow | undefined;
  return row === undefined ? null : rowToCharacter(row);
}

export async function getCharacterWithClass(characterId: number): Promise<CharacterSessionRow & CharacterCombatStats | null> {
  const row = getDb().prepare(`SELECT c.id, c.account_id, c.name, cc.\`key\` AS class_key,
      c.zone_id, c.pos_x, c.pos_y, c.level, c.appearance, c.hp, c.max_hp, cs.attack, cs.defense, cs.speed,
      cs.crit_chance, cs.crit_multiplier FROM characters c JOIN character_classes cc ON cc.id = c.class_id
      LEFT JOIN character_stats cs ON cs.character_id = c.id WHERE c.id = ? LIMIT 1`).get(characterId) as SqlRow | undefined;
  if (row === undefined) return null;
  const derived = getDerivedEquipmentStats(characterId, {
    attack: Number(row.attack ?? 10),
    defense: Number(row.defense ?? 5),
    speed: Number(row.speed ?? 180),
    critChance: Number(row.crit_chance ?? 5),
    critMultiplier: Number(row.crit_multiplier ?? 1.5),
  });
  const classKey = String(row.class_key ?? "");
  return {
    id: Number(row.id), account_id: Number(row.account_id), name: String(row.name ?? ""), class_key: classKey,
    appearance: normalizeAppearance(parseJsonObject(row.appearance), toClassKey(classKey)),
    zone_id: String(row.zone_id ?? "zone-clover-village"), pos_x: Number(row.pos_x ?? 0), pos_y: Number(row.pos_y ?? 0),
    level: Number(row.level ?? 1), hp: Number(row.hp ?? row.max_hp ?? 100), max_hp: Number(row.max_hp ?? 100),
    attack: derived.attack, defense: derived.defense, speed: derived.speed, crit_chance: derived.critChance,
    crit_multiplier: derived.critMultiplier, parcel_capacity: derived.parcelCapacity, movement_bonus: derived.movementBonus,
    fragile_protection: derived.fragileProtection, weather_protection: derived.weatherProtection, navigation_bonus: derived.navigationBonus,
  };
}

/** Load all server-owned data needed by the Character Info, Inventory, and Skill Tree screens. */
export async function getCharacterProfile(characterId: number): Promise<CharacterProfile | null> {
  const db = getDb();
  const row = db.prepare(`SELECT c.id, c.account_id, c.class_id, c.name, c.appearance, c.zone_id, c.pos_x, c.pos_y,
      c.level, c.experience, c.stamps, c.courier_rank, c.hp, c.max_hp, c.resource_current, c.skill_points,
      cc.\`key\` AS class_key, cc.display_name AS class_name, cc.animal, cc.role, cc.primary_resource,
      cc.resource_max, cc.description AS class_description,
      cs.attack, cs.defense, cs.speed, cs.crit_chance, cs.crit_multiplier,
      cs.stamina_max, cs.stamina_regen, cs.mana_max, cs.mana_regen, cs.focus_max, cs.focus_regen
      FROM characters c JOIN character_classes cc ON cc.id = c.class_id
      LEFT JOIN character_stats cs ON cs.character_id = c.id WHERE c.id = ? LIMIT 1`).get(characterId) as SqlRow | undefined;
  if (row === undefined) return null;
  const equipmentState = getInventoryState(characterId);
  const skillRows = db.prepare(`SELECT s.skill_key, s.name, s.description, s.cost, s.required_level,
      s.prerequisite_key, CASE WHEN cs.skill_key IS NULL THEN 0 ELSE 1 END AS unlocked
      FROM skill_definitions s LEFT JOIN character_skills cs ON cs.skill_key = s.skill_key AND cs.character_id = ?
      WHERE s.class_key = ? ORDER BY s.required_level ASC, s.skill_key ASC`).all(characterId, String(row.class_key ?? "")) as SqlRow[];
  const stats: Record<string, number> = {};
  for (const key of ["attack", "defense", "speed", "crit_chance", "crit_multiplier", "stamina_max", "stamina_regen", "mana_max", "mana_regen", "focus_max", "focus_regen"]) {
    if (row[key] !== null && row[key] !== undefined) stats[key] = Number(row[key]);
  }
  return {
    character: { id: Number(row.id), name: String(row.name ?? ""), classId: Number(row.class_id), level: Number(row.level ?? 1), experience: Number(row.experience ?? 0), stamps: Number(row.stamps ?? 0), courierRank: String(row.courier_rank ?? "Trainee"), hp: Number(row.hp ?? 0), maxHp: Number(row.max_hp ?? 0), resource: Number(row.resource_current ?? 0), zoneId: String(row.zone_id ?? ""), pos: { x: Number(row.pos_x ?? 0), y: Number(row.pos_y ?? 0) }, appearance: parseJsonObject(row.appearance) },
    class: { key: String(row.class_key ?? ""), name: String(row.class_name ?? ""), animal: String(row.animal ?? ""), role: String(row.role ?? ""), primaryResource: String(row.primary_resource ?? ""), resourceMax: Number(row.resource_max ?? 0), description: String(row.class_description ?? "") },
    stats,
    inventory: { slotCount: equipmentState.slotCount, items: equipmentState.items.map((item) => ({ instanceId: item.itemInstanceId, slot: item.slot, quantity: item.quantity, key: item.itemKey, name: item.name, description: item.description, category: item.category, rarity: item.rarity, icon: item.icon, equippedSlot: item.equippedSlot, equipmentSlot: item.equipmentSlot })) },
    equipment: equipmentState.equipment,
    derived: equipmentState.stats,
    skills: { skillPoints: Number(row.skill_points ?? 0), entries: skillRows.map((skill) => ({ key: String(skill.skill_key), name: String(skill.name), description: String(skill.description), cost: Number(skill.cost ?? 1), requiredLevel: Number(skill.required_level ?? 1), prerequisiteKey: skill.prerequisite_key === null ? null : String(skill.prerequisite_key), unlocked: Number(skill.unlocked) === 1 })) },
  };
}

/** Store loot in SQLite, merging stacks and allocating the first free slot; returns what was actually stored. */
export async function grantInventoryItems(characterId: number, items: { itemKey: string; quantity: number }[]): Promise<{ itemKey: string; quantity: number }[]> {
  const granted: { itemKey: string; quantity: number }[] = [];
  const db = getDb();
  const inventory = db.prepare("SELECT slot_count FROM inventories WHERE character_id = ?").get(characterId) as SqlRow | undefined;
  if (inventory === undefined) return granted;
  const effectiveSlotCount = getEffectiveSlotCount(characterId);
  // Archived items (admin panel, spec §25–26) are no longer granted.
  const findDef = db.prepare("SELECT id, max_stack FROM item_definitions WHERE key = ? AND is_deleted = 0 LIMIT 1");
  const findStacks = db.prepare("SELECT id, quantity FROM inventory_items WHERE character_id = ? AND item_definition_id = ? AND quantity < ? ORDER BY id ASC");
  const findSlot = db.prepare("SELECT slot FROM inventory_items WHERE character_id = ? AND slot IS NOT NULL");
  const insert = db.prepare("INSERT INTO inventory_items (character_id, item_definition_id, slot, quantity) VALUES (?, ?, ?, ?)");
  for (const item of items) {
    const requested = Math.max(1, Math.floor(item.quantity));
    let remaining = requested;
    const def = findDef.get(item.itemKey) as SqlRow | undefined;
    if (def === undefined) continue;
    const maxStack = Math.max(1, Number(def.max_stack ?? 1));
    const stacks = findStacks.all(characterId, Number(def.id), maxStack) as SqlRow[];
    for (const stack of stacks) {
      if (remaining <= 0) break;
      const add = Math.min(remaining, maxStack - Number(stack.quantity));
      if (add <= 0) continue;
      db.prepare("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?").run(add, Number(stack.id));
      auditInventoryEvent(characterId, "item_grant", Number(stack.id), add, "monster_loot");
      remaining -= add;
    }
    while (remaining > 0) {
      const used = new Set(findSlot.all(characterId).map((r) => Number((r as SqlRow).slot)));
      let slot: number | null = null;
      for (let candidate = 0; candidate < effectiveSlotCount; candidate++) if (!used.has(candidate)) { slot = candidate; break; }
      if (slot === null) break;
      const add = Math.min(remaining, maxStack);
      const inserted = insert.run(characterId, Number(def.id), slot, add);
      auditInventoryEvent(characterId, "item_grant", Number(inserted.lastInsertRowid), add, "monster_loot");
      remaining -= add;
    }
    if (remaining < requested) granted.push({ itemKey: item.itemKey, quantity: requested - remaining });
    if (remaining > 0) return granted;
  }
  return granted;
}

export async function unlockSkill(characterId: number, skillKey: string): Promise<UnlockSkillResult> {
  const db = getDb();
  const character = db.prepare("SELECT c.id, c.level, c.skill_points, cc.key AS class_key FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE c.id = ?").get(characterId) as SqlRow | undefined;
  if (character === undefined) return { ok: false, reason: "CHARACTER_NOT_FOUND" };
  const skill = db.prepare("SELECT skill_key, cost, required_level, prerequisite_key, class_key FROM skill_definitions WHERE skill_key = ?").get(skillKey) as SqlRow | undefined;
  if (skill === undefined) return { ok: false, reason: "SKILL_NOT_FOUND" };
  if (String(skill.class_key) !== String(character.class_key)) return { ok: false, reason: "WRONG_CLASS" };
  if (Number(character.level) < Number(skill.required_level)) return { ok: false, reason: "LEVEL_REQUIRED" };
  if (skill.prerequisite_key !== null && db.prepare("SELECT 1 FROM character_skills WHERE character_id = ? AND skill_key = ?").get(characterId, String(skill.prerequisite_key)) === undefined) return { ok: false, reason: "PREREQUISITE_REQUIRED" };
  if (db.prepare("SELECT 1 FROM character_skills WHERE character_id = ? AND skill_key = ?").get(characterId, skillKey) !== undefined) return { ok: false, reason: "ALREADY_UNLOCKED" };
  if (Number(character.skill_points) < Number(skill.cost)) return { ok: false, reason: "NOT_ENOUGH_POINTS" };
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO character_skills (character_id, skill_key) VALUES (?, ?)").run(characterId, skillKey);
    db.prepare("UPDATE characters SET skill_points = skill_points - ?, updated_at = ? WHERE id = ?").run(Number(skill.cost), new Date().toISOString(), characterId);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
    throw err;
  }
  const profile = await getCharacterProfile(characterId);
  return profile === null ? { ok: false, reason: "CHARACTER_NOT_FOUND" } : { ok: true, profile };
}

export async function updateCharacterAppearance(characterId: number, appearance: Appearance): Promise<void> {
  getDb().prepare("UPDATE characters SET appearance = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(appearance), new Date().toISOString(), characterId);
}

export async function updateCharacterHp(characterId: number, hp: number, maxHp: number): Promise<void> {
  getDb().prepare("UPDATE characters SET hp = ?, max_hp = ?, updated_at = ? WHERE id = ?").run(hp, maxHp, new Date().toISOString(), characterId);
}

/** Add XP and return the post-grant progression (same shape deliveries send), or null for an unknown character. */
export async function grantExperience(characterId: number, amount: number): Promise<QuestProgression | null> {
  const db = getDb();
  const row = db.prepare("SELECT experience, level, skill_points, courier_rank FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  if (row === undefined) return null;
  const previousLevel = Number(row.level ?? 1);
  const next = Math.max(0, Number(row.experience ?? 0) + Math.max(0, amount));
  const { level, skillPoints } = applyExperience(
    previousLevel,
    Number(row.skill_points ?? 0),
    next,
  );
  db.prepare("UPDATE characters SET experience = ?, level = ?, skill_points = ?, updated_at = ? WHERE id = ?")
    .run(next, level, skillPoints, new Date().toISOString(), characterId);
  return {
    level,
    previousLevel,
    levelsGained: Math.max(0, level - previousLevel),
    experience: next,
    skillPoints,
    courierRank: String(row.courier_rank ?? "Trainee"),
    rankPromotion: null,
  };
}

export async function updateCharacterPosition(characterId: number, zoneId: string, posX: number, posY: number): Promise<void> {
  getDb().prepare("UPDATE characters SET zone_id = ?, pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ?").run(zoneId, posX, posY, new Date().toISOString(), characterId);
}

function rowToCharacter(row: SqlRow): CharacterRow {
  return { id: Number(row.id), account_id: Number(row.account_id), class_id: Number(row.class_id), name: String(row.name ?? ""), zone_id: String(row.zone_id ?? ""), pos_x: Number(row.pos_x ?? 0), pos_y: Number(row.pos_y ?? 0), level: Number(row.level ?? 1), appearance: parseJsonObject(row.appearance) };
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try { const parsed: unknown = JSON.parse(raw); return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
