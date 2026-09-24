import type { EquipmentSlot } from "../../../src/types/ItemTypes.ts";
import { getDb } from "../db/connection.ts";

type SqlRow = Record<string, unknown>;

export interface EquipmentStats {
  attack: number;
  defense: number;
  speed: number;
  critChance: number;
  critMultiplier: number;
  parcelCapacity: number;
  movementBonus: number;
  fragileProtection: number;
  weatherProtection: number;
  navigationBonus: number;
}

export interface InventoryItemSnapshot {
  itemInstanceId: number;
  itemKey: string;
  name: string;
  description: string;
  category: string;
  rarity: string;
  icon: string | null;
  slot: number | null;
  quantity: number;
  locked: boolean;
  equippedSlot: EquipmentSlot | null;
  equipmentSlot: EquipmentSlot | null;
  itemStats: Record<string, number>;
  courierEffects: Record<string, number>;
}

export interface EquipmentSnapshot {
  slot: EquipmentSlot;
  itemInstanceId: number;
  itemKey: string;
  name: string;
  description: string;
  rarity: string;
  icon: string | null;
  itemStats: Record<string, number>;
  courierEffects: Record<string, number>;
}

export interface InventoryState {
  slotCount: number;
  stamps: number;
  items: InventoryItemSnapshot[];
  equipment: EquipmentSnapshot[];
  stats: EquipmentStats;
}

export type EquipmentMutationResult =
  | { ok: true; inventory: InventoryState; message: string }
  | { ok: false; reason: "ITEM_NOT_OWNED" | "ITEM_LOCKED" | "ITEM_EQUIPPED" | "INVALID_SLOT" | "SLOT_OCCUPIED" | "CLASS_RESTRICTED" | "LEVEL_REQUIRED" | "INVENTORY_FULL" | "NOT_EQUIPPED" };

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ["head", "body", "weapon", "accessory", "boots", "courier-bag"];

/** Return the complete authoritative inventory/equipment snapshot. */
export function getInventoryState(characterId: number): InventoryState {
  const db = getDb();
  const base = db.prepare(`SELECT c.stamps, cs.attack, cs.defense, cs.speed, cs.crit_chance, cs.crit_multiplier
    FROM characters c LEFT JOIN character_stats cs ON cs.character_id = c.id WHERE c.id = ?`).get(characterId) as SqlRow | undefined;
  const stats = getDerivedEquipmentStats(characterId, {
    attack: Number(base?.attack ?? 10),
    defense: Number(base?.defense ?? 5),
    speed: Number(base?.speed ?? 180),
    critChance: Number(base?.crit_chance ?? 5),
    critMultiplier: Number(base?.crit_multiplier ?? 1.5),
  });
  const slotCount = getEffectiveSlotCount(characterId, stats);
  const rows = db.prepare(`SELECT i.id, i.slot, i.quantity, i.stack_meta,
      d.key, d.name, d.description, d.category, d.rarity, d.icon,
      d.equipment_slot, d.base_stats, d.courier_effects, e.slot AS equipped_slot
    FROM inventory_items i
    JOIN item_definitions d ON d.id = i.item_definition_id
    LEFT JOIN equipment e ON e.item_instance_id = i.id
   WHERE i.character_id = ? ORDER BY COALESCE(i.slot, 9999), i.id`).all(characterId) as SqlRow[];
  const items = rows.map((row) => rowToInventoryItem(row));
  const equipment = rows
    .filter((row) => row.equipped_slot !== null)
    .map((row) => rowToEquipment(row));
  return { slotCount, stamps: Number(base?.stamps ?? 0), items, equipment, stats };
}

/** Compute combat and courier bonuses from the character's equipped JSON gear. */
export function getDerivedEquipmentStats(characterId: number, base: {
  attack: number;
  defense: number;
  speed: number;
  critChance: number;
  critMultiplier: number;
}): EquipmentStats {
  const rows = getDb().prepare(`SELECT d.base_stats, d.courier_effects
    FROM equipment e JOIN inventory_items i ON i.id = e.item_instance_id
    JOIN item_definitions d ON d.id = i.item_definition_id
   WHERE e.character_id = ?`).all(characterId) as SqlRow[];
  const stats: EquipmentStats = {
    attack: base.attack,
    defense: base.defense,
    speed: base.speed,
    critChance: base.critChance,
    critMultiplier: base.critMultiplier,
    parcelCapacity: 0,
    movementBonus: 0,
    fragileProtection: 0,
    weatherProtection: 0,
    navigationBonus: 0,
  };
  for (const row of rows) {
    const itemStats = parseNumericObject(row.base_stats);
    const effects = parseNumericObject(row.courier_effects);
    stats.attack += itemStats.attack ?? 0;
    stats.defense += itemStats.defense ?? 0;
    stats.speed += itemStats.speed ?? 0;
    stats.critChance += itemStats.critChance ?? itemStats.crit_chance ?? 0;
    stats.critMultiplier += itemStats.critMultiplier ?? itemStats.crit_multiplier ?? 0;
    stats.parcelCapacity += effects.parcelCapacity ?? 0;
    stats.movementBonus += effects.movementBonus ?? 0;
    stats.fragileProtection += effects.fragileProtection ?? 0;
    stats.weatherProtection += effects.weatherProtection ?? 0;
    stats.navigationBonus += effects.navigationBonus ?? 0;
  }
  stats.speed = Math.max(1, stats.speed * (1 + Math.max(0, stats.movementBonus)));
  return stats;
}

/** Effective inventory size includes any equipped courier-bag capacity. */
export function getEffectiveSlotCount(characterId: number, stats?: EquipmentStats): number {
  const base = Number((getDb().prepare("SELECT slot_count FROM inventories WHERE character_id = ?").get(characterId) as SqlRow | undefined)?.slot_count ?? 12);
  const effective = stats ?? getInventoryState(characterId).stats;
  return Math.max(base, base + Math.floor(Math.max(0, effective.parcelCapacity)));
}

/** Move an owned, unlocked item into an empty inventory slot. */
export function moveInventoryItem(characterId: number, itemInstanceId: number, targetSlot: number): EquipmentMutationResult {
  if (!Number.isInteger(targetSlot) || targetSlot < 0) return { ok: false, reason: "INVALID_SLOT" };
  const state = getInventoryState(characterId);
  if (targetSlot >= state.slotCount) return { ok: false, reason: "INVALID_SLOT" };
  const db = getDb();
  const item = db.prepare("SELECT id, slot, stack_meta FROM inventory_items WHERE id = ? AND character_id = ? LIMIT 1").get(itemInstanceId, characterId) as SqlRow | undefined;
  if (item === undefined) return { ok: false, reason: "ITEM_NOT_OWNED" };
  if (db.prepare("SELECT 1 FROM equipment WHERE item_instance_id = ?").get(itemInstanceId) !== undefined) return { ok: false, reason: "ITEM_EQUIPPED" };
  if (isLocked(item.stack_meta)) return { ok: false, reason: "ITEM_LOCKED" };
  const occupied = db.prepare("SELECT id FROM inventory_items WHERE character_id = ? AND slot = ? AND id <> ? LIMIT 1").get(characterId, targetSlot, itemInstanceId);
  if (occupied !== undefined) return { ok: false, reason: "SLOT_OCCUPIED" };
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE inventory_items SET slot = ? WHERE id = ? AND character_id = ?").run(targetSlot, itemInstanceId, characterId);      auditInventoryEvent(characterId, "item_move", itemInstanceId, 0, `inventory_slot:${targetSlot}`);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw err;
  }
  return { ok: true, inventory: getInventoryState(characterId), message: "Inventory slot updated." };
}

/** Equip an owned item, swapping the previous occupant back into its inventory slot. */
export function equipItem(characterId: number, itemInstanceId: number, requestedSlot?: string): EquipmentMutationResult {
  const db = getDb();
  const item = db.prepare(`SELECT i.id, i.slot, i.stack_meta, d.equipment_slot, d.required_class, d.required_level
    FROM inventory_items i JOIN item_definitions d ON d.id = i.item_definition_id
   WHERE i.id = ? AND i.character_id = ? LIMIT 1`).get(itemInstanceId, characterId) as SqlRow | undefined;
  if (item === undefined) return { ok: false, reason: "ITEM_NOT_OWNED" };
  if (isLocked(item.stack_meta)) return { ok: false, reason: "ITEM_LOCKED" };
  if (db.prepare("SELECT 1 FROM equipment WHERE item_instance_id = ?").get(itemInstanceId) !== undefined) return { ok: false, reason: "ITEM_EQUIPPED" };
  const slot = typeof item.equipment_slot === "string" ? item.equipment_slot : "";
  if (!isEquipmentSlot(slot) || (requestedSlot !== undefined && requestedSlot !== slot)) return { ok: false, reason: "INVALID_SLOT" };
  const character = db.prepare("SELECT c.level, cc.key AS class_key FROM characters c JOIN character_classes cc ON cc.id = c.class_id WHERE c.id = ?").get(characterId) as SqlRow | undefined;
  if (character === undefined) return { ok: false, reason: "ITEM_NOT_OWNED" };
  if (item.required_class !== null && item.required_class !== undefined && String(item.required_class) !== String(character.class_key)) return { ok: false, reason: "CLASS_RESTRICTED" };
  if (Number(character.level ?? 1) < Number(item.required_level ?? 1)) return { ok: false, reason: "LEVEL_REQUIRED" };
  const previous = db.prepare("SELECT item_instance_id FROM equipment WHERE character_id = ? AND slot = ? LIMIT 1").get(characterId, slot) as SqlRow | undefined;
  const incomingSlot = item.slot === null ? null : Number(item.slot);
  db.exec("BEGIN");
  try {
    if (previous !== undefined) {
      db.prepare("DELETE FROM equipment WHERE character_id = ? AND slot = ?").run(characterId, slot);
      db.prepare("UPDATE inventory_items SET slot = ? WHERE id = ? AND character_id = ?").run(incomingSlot, Number(previous.item_instance_id), characterId);
      auditInventoryEvent(characterId, "unequip_item", Number(previous.item_instance_id), 0, `swap:${slot}`);
    }
    db.prepare("UPDATE inventory_items SET slot = NULL WHERE id = ? AND character_id = ?").run(itemInstanceId, characterId);
    db.prepare("INSERT INTO equipment (character_id, slot, item_instance_id) VALUES (?, ?, ?)").run(characterId, slot, itemInstanceId);
    auditInventoryEvent(characterId, "equip_item", itemInstanceId, 0, `equipment_slot:${slot}`);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw err;
  }
  return { ok: true, inventory: getInventoryState(characterId), message: `${slotLabel(slot)} equipped.` };
}

/** Unequip a slot into the first free effective inventory slot. */
export function unequipItem(characterId: number, slot: string): EquipmentMutationResult {
  if (!isEquipmentSlot(slot)) return { ok: false, reason: "INVALID_SLOT" };
  const db = getDb();
  const equipped = db.prepare("SELECT item_instance_id FROM equipment WHERE character_id = ? AND slot = ? LIMIT 1").get(characterId, slot) as SqlRow | undefined;
  if (equipped === undefined) return { ok: false, reason: "NOT_EQUIPPED" };
  const state = getInventoryState(characterId);
  const used = new Set(state.items.filter((item) => item.slot !== null).map((item) => item.slot as number));
  // A courier bag's bonus slots vanish with it: refuse if they hold items, and never unequip into them.
  const lostCapacity = state.equipment.find((entry) => entry.slot === slot)?.courierEffects.parcelCapacity ?? 0;
  const slotCount = getEffectiveSlotCount(characterId, { ...state.stats, parcelCapacity: state.stats.parcelCapacity - lostCapacity });
  if ([...used].some((occupied) => occupied >= slotCount)) return { ok: false, reason: "INVENTORY_FULL" };
  let free: number | null = null;
  for (let candidate = 0; candidate < slotCount; candidate += 1) if (!used.has(candidate)) { free = candidate; break; }
  if (free === null) return { ok: false, reason: "INVENTORY_FULL" };
  const instanceId = Number(equipped.item_instance_id);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM equipment WHERE character_id = ? AND slot = ?").run(characterId, slot);
    db.prepare("UPDATE inventory_items SET slot = ? WHERE id = ? AND character_id = ?").run(free, instanceId, characterId);
    auditInventoryEvent(characterId, "unequip_item", instanceId, 0, `equipment_slot:${slot}`);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw err;
  }
  return { ok: true, inventory: getInventoryState(characterId), message: `${slotLabel(slot)} unequipped.` };
}

function rowToInventoryItem(row: SqlRow): InventoryItemSnapshot {
  return {
    itemInstanceId: Number(row.id),
    itemKey: String(row.key ?? ""),
    name: String(row.name ?? "Unknown item"),
    description: String(row.description ?? ""),
    category: String(row.category ?? ""),
    rarity: String(row.rarity ?? "common"),
    icon: row.icon === null ? null : String(row.icon ?? ""),
    slot: row.slot === null ? null : Number(row.slot),
    quantity: Number(row.quantity ?? 1),
    locked: isLocked(row.stack_meta),
    equippedSlot: row.equipped_slot === null ? null : String(row.equipped_slot) as EquipmentSlot,
    equipmentSlot: row.equipment_slot === null ? null : String(row.equipment_slot) as EquipmentSlot,
    itemStats: parseNumericObject(row.base_stats),
    courierEffects: parseNumericObject(row.courier_effects),
  };
}

function rowToEquipment(row: SqlRow): EquipmentSnapshot {
  return {
    slot: String(row.equipped_slot) as EquipmentSlot,
    itemInstanceId: Number(row.id),
    itemKey: String(row.key ?? ""),
    name: String(row.name ?? "Unknown item"),
    description: String(row.description ?? ""),
    rarity: String(row.rarity ?? "common"),
    icon: row.icon === null ? null : String(row.icon ?? ""),
    itemStats: parseNumericObject(row.base_stats),
    courierEffects: parseNumericObject(row.courier_effects),
  };
}

function parseNumericObject(raw: unknown): Record<string, number> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "number" && Number.isFinite(value))) as Record<string, number>;
  } catch { return {}; }
}

function isLocked(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try { return (JSON.parse(raw) as { locked?: unknown }).locked === true; } catch { return false; }
}

function isEquipmentSlot(raw: string): raw is EquipmentSlot {
  return (EQUIPMENT_SLOTS as readonly string[]).includes(raw);
}

function slotLabel(slot: string): string {
  return slot === "courier-bag" ? "Courier bag" : slot.charAt(0).toUpperCase() + slot.slice(1);
}

export function auditInventoryEvent(characterId: number, eventType: string, instanceId: number, quantity: number, reason: string): void {
  const db = getDb();
  const definition = db.prepare("SELECT item_definition_id FROM inventory_items WHERE id = ?").get(instanceId) as SqlRow | undefined;
  const balance = Number((db.prepare("SELECT stamps FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined)?.stamps ?? 0);
  db.prepare(`INSERT INTO audit_economy_events
    (character_id, event_type, item_definition_id, quantity, balance_after, reason)
    VALUES (?, ?, ?, ?, ?, ?)`).run(characterId, eventType, definition?.item_definition_id === undefined ? null : Number(definition.item_definition_id), quantity, balance, reason);
}
