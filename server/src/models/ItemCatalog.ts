import { getDb } from "../db/connection.ts";
import classesJson from "../../../src/data/classes.json" with { type: "json" };
import questsJson from "../../../src/data/quests.json" with { type: "json" };

type SqlRow = Record<string, unknown>;

/**
 * Item Database / Item Editor model (spec §25–26).
 *
 * `item_definitions` is the server's runtime item catalog (inventory
 * presentation, equipped stats, loot + quest rewards), so panel edits here are
 * live for players. Rows authored or edited in the panel are marked
 * `source = 'admin'` and `syncItems()` leaves them alone, which makes editor
 * changes survive restarts; deleting is an archive (`is_deleted = 1`) rather
 * than a hard delete that the JSON sync would resurrect.
 */

// ---- authoring vocabulary (mirrors src/systems/ContentValidator.ts) ----

export const ITEM_CATEGORIES = [
  "resource",
  "gift",
  "delivery",
  "quest",
  "cosmetic",
  "material",
  "equipment",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const EQUIPMENT_SLOTS = ["head", "body", "weapon", "accessory", "boots", "courier-bag"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export const ITEM_RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/** Stat keys Equipment.ts folds into derived combat stats. */
export const EQUIPMENT_STAT_KEYS = ["attack", "defense", "speed", "critChance", "critMultiplier"] as const;
/** Courier bonus keys Equipment.ts applies. */
export const COURIER_EFFECT_KEYS = [
  "parcelCapacity",
  "movementBonus",
  "fragileProtection",
  "weatherProtection",
  "navigationBonus",
] as const;

export function classKeys(): string[] {
  return (classesJson.classes as { key: string }[]).map((cls) => cls.key);
}

/** Item keys are the JSON `id` values (e.g. "item-strawberry"). */
const KEY_PATTERN = /^item-[a-z0-9]+(-[a-z0-9]+)*$/;
const ICON_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---- shapes ----

/** Editable fields, already validated and normalized. */
export interface ItemFields {
  key: string;
  name: string;
  description: string;
  category: ItemCategory;
  maxStack: number;
  icon: string;
  rarity: ItemRarity;
  value: number;
  equipmentSlot: EquipmentSlot | null;
  stats: Record<string, number>;
  courierEffects: Record<string, number>;
  requiredClass: string | null;
  requiredLevel: number;
}

export interface ItemCatalogRow extends ItemFields {
  id: number;
  source: "content" | "admin";
  isDeleted: boolean;
  updatedAt: string | null;
  updatedBy: string;
}

export interface ItemValidationIssue {
  field: string;
  message: string;
}

export type ItemValidationResult =
  | { ok: true; value: ItemFields }
  | { ok: false; issues: ItemValidationIssue[] };

export interface ItemQuery {
  search?: string;
  category?: string;
  rarity?: string;
  source?: string;
  includeArchived?: boolean;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

export interface ItemListResult {
  items: ItemCatalogRow[];
  total: number;
  facets: {
    categories: { value: string; count: number }[];
    rarities: { value: string; count: number }[];
    sources: { value: string; count: number }[];
  };
}

export interface ItemReferences {
  inventoryCount: number;
  equippedCount: number;
  charactersOwning: number;
  quests: { id: string; title: string; role: "required" | "reward" }[];
  monsters: { key: string; name: string }[];
}

// ---- row mapping ----

function parseNumberMap(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function rowToItem(row: SqlRow): ItemCatalogRow {
  const isEquipment = String(row.category ?? "") === "equipment";
  const slot = row.equipment_slot === null || row.equipment_slot === undefined ? null : String(row.equipment_slot);
  return {
    id: Number(row.id),
    key: String(row.key ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    category: String(row.category ?? "material") as ItemCategory,
    maxStack: Number(row.max_stack ?? 1),
    icon: String(row.icon ?? ""),
    rarity: String(row.rarity ?? "common") as ItemRarity,
    value: Number(row.value ?? 0),
    equipmentSlot: isEquipment && slot !== null ? (slot as EquipmentSlot) : null,
    stats: isEquipment ? parseNumberMap(row.base_stats) : {},
    courierEffects: isEquipment ? parseNumberMap(row.courier_effects) : {},
    requiredClass: isEquipment && row.required_class !== null && row.required_class !== undefined ? String(row.required_class) : null,
    requiredLevel: Number(row.required_level ?? 1),
    source: String(row.source ?? "content") === "admin" ? "admin" : "content",
    isDeleted: Number(row.is_deleted ?? 0) === 1,
    updatedAt: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    updatedBy: String(row.updated_by ?? ""),
  };
}

const SELECT_COLUMNS =
  "id, `key`, name, description, category, max_stack, icon, base_stats, rarity, value, " +
  "equipment_slot, courier_effects, required_class, required_level, source, is_deleted, updated_at, updated_by";

// ---- validation ----

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function readNumberMap(
  value: unknown,
  allowed: readonly string[],
  field: string,
  issues: ItemValidationIssue[],
): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    issues.push({ field, message: `${field} must be an object of numeric values` });
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      issues.push({ field: `${field}.${key}`, message: `Unknown ${field} key "${key}" (allowed: ${allowed.join(", ")})` });
      continue;
    }
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      issues.push({ field: `${field}.${key}`, message: `${field}.${key} must be a finite, non-negative number` });
      continue;
    }
    out[key] = parsed;
  }
  return out;
}

/**
 * Validate + normalize editor payloads. Equipment metadata is required for the
 * equipment category and stripped for every other category, matching the
 * invariants ContentValidator enforces on the authored JSON catalog.
 */
export function validateItemFields(raw: Record<string, unknown>, opts: { keyEditable: boolean }): ItemValidationResult {
  const issues: ItemValidationIssue[] = [];

  const key = (asString(raw.key) ?? "").trim();
  if (opts.keyEditable) {
    if (key === "") issues.push({ field: "key", message: "key is required" });
    else if (!KEY_PATTERN.test(key)) {
      issues.push({ field: "key", message: 'key must be lowercase kebab-case starting with "item-" (e.g. item-moon-charm)' });
    }
  }

  const name = (asString(raw.name) ?? "").trim();
  if (name.length === 0) issues.push({ field: "name", message: "name is required" });
  else if (name.length > 100) issues.push({ field: "name", message: "name must be 100 characters or fewer" });

  const description = (asString(raw.description) ?? "").trim();
  if (description.length > 500) issues.push({ field: "description", message: "description must be 500 characters or fewer" });

  const category = (asString(raw.category) ?? "").trim() as ItemCategory;
  if (!ITEM_CATEGORIES.includes(category)) {
    issues.push({ field: "category", message: `category must be one of: ${ITEM_CATEGORIES.join(", ")}` });
  }

  const maxStack = asInt(raw.maxStack);
  if (maxStack === null || maxStack < 1 || maxStack > 999) {
    issues.push({ field: "maxStack", message: "maxStack must be an integer between 1 and 999" });
  }

  const icon = (asString(raw.icon) ?? "").trim();
  if (icon === "" || !ICON_PATTERN.test(icon)) {
    issues.push({ field: "icon", message: "icon must be a lowercase asset key (e.g. berry-strawberry)" });
  }

  const rarity = (asString(raw.rarity) ?? "common").trim() as ItemRarity;
  if (!ITEM_RARITIES.includes(rarity)) {
    issues.push({ field: "rarity", message: `rarity must be one of: ${ITEM_RARITIES.join(", ")}` });
  }

  const value = asInt(raw.value ?? 0);
  if (value === null || value < 0 || value > 10_000_000) {
    issues.push({ field: "value", message: "value must be an integer between 0 and 10,000,000" });
  }

  const isEquipment = category === "equipment";
  let equipmentSlot: EquipmentSlot | null = null;
  let stats: Record<string, number> = {};
  let courierEffects: Record<string, number> = {};
  let requiredClass: string | null = null;
  let requiredLevel = 1;

  if (isEquipment) {
    const slot = (asString(raw.equipmentSlot) ?? "").trim();
    if (!EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)) {
      issues.push({ field: "equipmentSlot", message: `equipmentSlot must be one of: ${EQUIPMENT_SLOTS.join(", ")}` });
    } else {
      equipmentSlot = slot as EquipmentSlot;
    }
    stats = readNumberMap(raw.stats, EQUIPMENT_STAT_KEYS, "stats", issues);
    courierEffects = readNumberMap(raw.courierEffects, COURIER_EFFECT_KEYS, "courierEffects", issues);

    const required = (asString(raw.requiredClass) ?? "").trim();
    if (required !== "") {
      if (!classKeys().includes(required)) {
        issues.push({ field: "requiredClass", message: `requiredClass must be a known class (${classKeys().join(", ")})` });
      } else {
        requiredClass = required;
      }
    }
    const level = asInt(raw.requiredLevel ?? 1);
    if (level === null || level < 1 || level > 999) {
      issues.push({ field: "requiredLevel", message: "requiredLevel must be an integer between 1 and 999" });
    } else {
      requiredLevel = level;
    }
  } else {
    // Non-equipment items never carry equipment metadata (ContentValidator
    // rejects it in the authored catalog, so the DB rows stay consistent).
    if (raw.equipmentSlot !== undefined && raw.equipmentSlot !== null && raw.equipmentSlot !== "") {
      issues.push({ field: "equipmentSlot", message: "equipment metadata is only valid for the equipment category" });
    }
    if (raw.stats !== undefined && Object.keys((raw.stats ?? {}) as Record<string, unknown>).length > 0) {
      issues.push({ field: "stats", message: "stats are only valid for the equipment category" });
    }
    if (raw.courierEffects !== undefined && Object.keys((raw.courierEffects ?? {}) as Record<string, unknown>).length > 0) {
      issues.push({ field: "courierEffects", message: "courierEffects are only valid for the equipment category" });
    }
    if (raw.requiredClass !== undefined && raw.requiredClass !== null && String(raw.requiredClass).trim() !== "") {
      issues.push({ field: "requiredClass", message: "requiredClass is only valid for the equipment category" });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      key,
      name,
      description,
      category,
      maxStack: maxStack as number,
      icon,
      rarity,
      value: value as number,
      equipmentSlot,
      stats,
      courierEffects,
      requiredClass,
      requiredLevel,
    },
  };
}

// ---- reads ----

const SORT_COLUMNS: Record<string, string> = {
  key: "`key`",
  name: "name",
  category: "category",
  rarity: "rarity",
  value: "value",
  stack: "max_stack",
  updated: "COALESCE(updated_at, '')",
};

function buildWhere(query: ItemQuery): { where: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (query.includeArchived !== true) conditions.push("is_deleted = 0");
  if (query.search !== undefined && query.search !== "") {
    conditions.push("(`key` LIKE ? OR name LIKE ? OR description LIKE ?)");
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  if (query.category !== undefined && query.category !== "") {
    conditions.push("category = ?");
    params.push(query.category);
  }
  if (query.rarity !== undefined && query.rarity !== "") {
    conditions.push("rarity = ?");
    params.push(query.rarity);
  }
  if (query.source !== undefined && query.source !== "") {
    conditions.push("source = ?");
    params.push(query.source);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** Paginated item search with facet counts for the filter bar (spec §25). */
export function listItems(query: ItemQuery): ItemListResult {
  const db = getDb();
  const { where, params } = buildWhere(query);
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM item_definitions ${where}`).get(...params) as SqlRow).n ?? 0);
  const sortColumn = SORT_COLUMNS[query.sort ?? "key"] ?? SORT_COLUMNS.key;
  const direction = (query.dir ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const limit = Math.min(Math.max(1, query.limit ?? 25), 200);
  const offset = Math.max(0, query.offset ?? 0);
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM item_definitions ${where} ORDER BY ${sortColumn} ${direction}, id ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as SqlRow[];

  const facetRows = db
    .prepare(
      `SELECT category, rarity, source, COUNT(*) AS n FROM item_definitions
       ${query.includeArchived === true ? "" : "WHERE is_deleted = 0"}
       GROUP BY category, rarity, source`,
    )
    .all() as SqlRow[];
  const tally = (field: string): { value: string; count: number }[] => {
    const counts = new Map<string, number>();
    for (const row of facetRows) {
      const key = String(row[field] ?? "");
      counts.set(key, (counts.get(key) ?? 0) + Number(row.n ?? 0));
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
  };

  return {
    items: rows.map(rowToItem),
    total,
    facets: { categories: tally("category"), rarities: tally("rarity"), sources: tally("source") },
  };
}

export function getItemById(itemId: number): ItemCatalogRow | null {
  const row = getDb().prepare(`SELECT ${SELECT_COLUMNS} FROM item_definitions WHERE id = ? LIMIT 1`).get(itemId) as SqlRow | undefined;
  return row === undefined ? null : rowToItem(row);
}

export function getItemByKey(key: string): ItemCatalogRow | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM item_definitions WHERE \`key\` = ? LIMIT 1`)
    .get(key) as SqlRow | undefined;
  return row === undefined ? null : rowToItem(row);
}

/**
 * Where an item is consumed, so the editor can warn before archiving
 * (spec §26 — the danger zone should show blast radius, not a bare confirm).
 */
export function getItemReferences(key: string): ItemReferences {
  const db = getDb();
  const join = "FROM inventory_items ii JOIN item_definitions d ON d.id = ii.item_definition_id WHERE d.`key` = ?";
  const inventoryCount = Number((db.prepare(`SELECT COUNT(*) AS n ${join}`).get(key) as SqlRow).n ?? 0);
  const equippedCount = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM equipment e WHERE e.item_instance_id IN (SELECT ii.id ${join})`).get(key) as SqlRow).n ?? 0,
  );
  const charactersOwning = Number(
    (db.prepare(`SELECT COUNT(DISTINCT ii.character_id) AS n ${join}`).get(key) as SqlRow).n ?? 0,
  );

  const monsters = (db.prepare("SELECT `key`, display_name, loot_table FROM monster_definitions ORDER BY `key` ASC").all() as SqlRow[])
    .filter((row) => {
      try {
        const table: unknown = JSON.parse(String(row.loot_table ?? "[]"));
        return Array.isArray(table) && table.some((entry) => (entry as { key?: unknown }).key === key);
      } catch {
        return false;
      }
    })
    .map((row) => ({ key: String(row.key ?? ""), name: String(row.display_name ?? "") }));

  const quests: ItemReferences["quests"] = (
    questsJson.quests as { id: string; title: string; requiredItemId?: string; rewardItemId?: string }[]
  ).flatMap((quest): ItemReferences["quests"] => {
    if (quest.requiredItemId === key) return [{ id: quest.id, title: quest.title, role: "required" }];
    if (quest.rewardItemId === key) return [{ id: quest.id, title: quest.title, role: "reward" }];
    return [];
  });

  return { inventoryCount, equippedCount, charactersOwning, quests, monsters };
}

// ---- writes ----

function statsJson(fields: ItemFields): string {
  return fields.category === "equipment" ? JSON.stringify(fields.stats) : "{}";
}

export type ItemMutationResult =
  | { ok: true; item: ItemCatalogRow }
  | { ok: false; reason: "KEY_TAKEN" | "KEY_REQUIRED" };

function keyExists(key: string, exceptId?: number): boolean {
  const row = getDb()
    .prepare("SELECT id FROM item_definitions WHERE `key` = ? LIMIT 1")
    .get(key) as SqlRow | undefined;
  return row !== undefined && (exceptId === undefined || Number(row.id) !== exceptId);
}

/** Create an admin-authored item row. Caller validates + audits. */
export function createItem(fields: ItemFields, updatedBy: string): ItemMutationResult {
  if (fields.key === "") return { ok: false, reason: "KEY_REQUIRED" };
  if (keyExists(fields.key)) return { ok: false, reason: "KEY_TAKEN" };
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO item_definitions
        (\`key\`, name, description, category, max_stack, icon, base_stats, rarity, value,
         equipment_slot, equipment_stats, courier_effects, required_class, required_level,
         source, is_deleted, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 0, ?, ?)`,
    )
    .run(
      fields.key,
      fields.name,
      fields.description,
      fields.category,
      fields.maxStack,
      fields.icon,
      statsJson(fields),
      fields.rarity,
      fields.value,
      fields.equipmentSlot,
      statsJson(fields),
      JSON.stringify(fields.category === "equipment" ? fields.courierEffects : {}),
      fields.requiredClass,
      fields.requiredLevel,
      now,
      updatedBy,
    );
  const item = getItemById(Number(info.lastInsertRowid));
  if (item === null) throw new Error("Item insert did not persist");
  return { ok: true, item };
}

/** Update an item row and hand ownership to the panel. Caller validates + audits. */
export function updateItem(itemId: number, fields: ItemFields, updatedBy: string): ItemMutationResult {
  const existing = getItemById(itemId);
  if (existing === null) throw new Error("Item disappeared during update");
  if (keyExists(fields.key, itemId)) return { ok: false, reason: "KEY_TAKEN" };
  getDb()
    .prepare(
      `UPDATE item_definitions SET
         \`key\` = ?, name = ?, description = ?, category = ?, max_stack = ?, icon = ?,
         base_stats = ?, rarity = ?, value = ?, equipment_slot = ?, equipment_stats = ?,
         courier_effects = ?, required_class = ?, required_level = ?,
         source = 'admin', updated_at = ?, updated_by = ?
       WHERE id = ?`,
    )
    .run(
      fields.key,
      fields.name,
      fields.description,
      fields.category,
      fields.maxStack,
      fields.icon,
      statsJson(fields),
      fields.rarity,
      fields.value,
      fields.equipmentSlot,
      statsJson(fields),
      JSON.stringify(fields.category === "equipment" ? fields.courierEffects : {}),
      fields.requiredClass,
      fields.requiredLevel,
      new Date().toISOString(),
      updatedBy,
      itemId,
    );
  const item = getItemById(itemId);
  if (item === null) throw new Error("Item update did not persist");
  return { ok: true, item };
}

/** Archive (soft delete): hidden from grants, kept for owned items + history. */
export function archiveItem(itemId: number, updatedBy: string): ItemCatalogRow | null {
  getDb()
    .prepare("UPDATE item_definitions SET is_deleted = 1, source = 'admin', updated_at = ?, updated_by = ? WHERE id = ?")
    .run(new Date().toISOString(), updatedBy, itemId);
  return getItemById(itemId);
}

/** Restore an archived item. Ownership stays with the panel so the JSON sync
 * cannot overwrite the restored row. */
export function restoreItem(itemId: number, updatedBy: string): ItemCatalogRow | null {
  getDb()
    .prepare("UPDATE item_definitions SET is_deleted = 0, source = 'admin', updated_at = ?, updated_by = ? WHERE id = ?")
    .run(new Date().toISOString(), updatedBy, itemId);
  return getItemById(itemId);
}
