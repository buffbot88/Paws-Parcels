import { getDb } from "../db/connection.ts";

type SqlRow = Record<string, unknown>;

export type QuestState = "locked" | "available" | "active" | "completed";

export interface QuestSnapshot {
  questId: string;
  title: string;
  description: string;
  type: string;
  giverId: string;
  targetId: string | null;
  requiredItemId: string | null;
  requiredQuantity: number;
  state: QuestState;
  progress: number;
  stampReward: number;
  xpReward: number;
  reputationNpcId: string | null;
  reputationPoints: number;
  chainPosition: number;
}

export interface QuestInventoryItem {
  itemInstanceId: number;
  itemKey: string;
  slot: number | null;
  quantity: number;
  locked: boolean;
}

export type QuestMutationResult =
  | { ok: true; quest: QuestSnapshot; quests: QuestSnapshot[]; inventory: QuestInventoryItem[]; stamps: number; xp: number; message: string }
  | { ok: false; reason: "QUEST_NOT_AVAILABLE" | "QUEST_PREREQUISITES_NOT_MET" | "QUEST_ALREADY_ACTIVE" | "QUEST_ALREADY_COMPLETE" | "INVENTORY_FULL" | "QUEST_NOT_ACTIVE" | "QUEST_ITEM_MISSING" | "WRONG_DELIVERY_TARGET" };

/** Return the ordered tutorial chain and make its initial state available. */
export async function getQuestState(characterId: number): Promise<QuestSnapshot[]> {
  const db = getDb();
  ensureCharacterQuestRows(characterId);
  refreshAvailableStates(characterId);
  const rows = db.prepare(`
    SELECT q.key, q.title, q.description, q.type, q.giver_npc_id, q.delivery_target_npc_id,
           i.key AS required_item_key, q.required_quantity, cq.state, cq.progress,
           q.stamp_reward, q.xp_reward, q.reputation_reward_npc_id,
           q.reputation_reward_points, q.chain_position
      FROM quest_definitions q
      LEFT JOIN character_quests cq ON cq.quest_id = q.id AND cq.character_id = ?
      LEFT JOIN item_definitions i ON i.id = q.required_item_definition_id
     WHERE q.chain_position > 0
     ORDER BY q.chain_position ASC`).all(characterId) as SqlRow[];
  return rows.map(rowToQuest);
}

/** Accept a currently available tutorial quest and create its locked parcel. */
export async function acceptQuest(characterId: number, questId: string): Promise<QuestMutationResult> {
  const db = getDb();
  ensureCharacterQuestRows(characterId);
  refreshAvailableStates(characterId);
  const quest = findQuest(characterId, questId);
  if (quest === null) return { ok: false, reason: "QUEST_NOT_AVAILABLE" };
  if (quest.state === "active") return { ok: false, reason: "QUEST_ALREADY_ACTIVE" };
  if (quest.state === "completed") return { ok: false, reason: "QUEST_ALREADY_COMPLETE" };
  const anotherActive = db.prepare("SELECT 1 FROM character_quests WHERE character_id = ? AND state = 'active' LIMIT 1").get(characterId);
  if (anotherActive !== undefined) return { ok: false, reason: "QUEST_ALREADY_ACTIVE" };
  if (quest.state !== "available") return { ok: false, reason: "QUEST_PREREQUISITES_NOT_MET" };

  const item = db.prepare(`SELECT id, max_stack FROM item_definitions WHERE id = ?`).get(Number(quest.required_item_definition_id)) as SqlRow | undefined;
  if (item === undefined) return { ok: false, reason: "INVENTORY_FULL" };
  const slotCount = Number((db.prepare("SELECT slot_count FROM inventories WHERE character_id = ?").get(characterId) as SqlRow | undefined)?.slot_count ?? 0);
  const used = new Set((db.prepare("SELECT slot FROM inventory_items WHERE character_id = ? AND slot IS NOT NULL").all(characterId) as SqlRow[]).map((row) => Number(row.slot)));
  let slot: number | null = null;
  for (let candidate = 0; candidate < slotCount; candidate += 1) {
    if (!used.has(candidate)) { slot = candidate; break; }
  }
  if (slot === null) return { ok: false, reason: "INVENTORY_FULL" };

  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO inventory_items
      (character_id, item_definition_id, slot, quantity, stack_meta)
      VALUES (?, ?, ?, 1, ?)`)
      .run(characterId, Number(item.id), slot, JSON.stringify({ questId, locked: true }));
    db.prepare("UPDATE character_quests SET state = 'active', progress = ?, accepted_at = ? WHERE character_id = ? AND quest_id = ?")
      .run(JSON.stringify({ delivered: 0 }) as string, new Date().toISOString(), characterId, Number(quest.quest_id));
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }

  const quests = await getQuestState(characterId);
  const updated = quests.find((entry) => entry.questId === questId) ?? questSnapshotFromRow(quest);
  return {
    ok: true,
    quest: updated,
    quests,
    inventory: getQuestInventory(characterId),
    stamps: getStamps(characterId),
    xp: getExperience(characterId),
    message: `Quest accepted: ${updated.title}`,
  };
}

/** Complete the active delivery for the NPC the character is interacting with. */
export async function completeDelivery(characterId: number, targetNpcId: string): Promise<QuestMutationResult> {
  const db = getDb();
  ensureCharacterQuestRows(characterId);
  const active = db.prepare(`
    SELECT q.id AS quest_id, q.key, q.title, q.description, q.type, q.giver_npc_id,
           q.delivery_target_npc_id, q.required_item_definition_id, q.required_quantity,
           q.stamp_reward, q.xp_reward, q.reputation_reward_npc_id,
           q.reputation_reward_points, q.chain_position, cq.state
      FROM quest_definitions q JOIN character_quests cq ON cq.quest_id = q.id
     WHERE cq.character_id = ? AND cq.state = 'active' AND q.delivery_target_npc_id = ?
     ORDER BY q.chain_position ASC LIMIT 1`).get(characterId, targetNpcId) as SqlRow | undefined;
  if (active === undefined) {
    const hasActive = db.prepare(`SELECT 1 FROM quest_definitions q JOIN character_quests cq ON cq.quest_id = q.id WHERE cq.character_id = ? AND cq.state = 'active'`).get(characterId) !== undefined;
    return { ok: false, reason: hasActive ? "WRONG_DELIVERY_TARGET" : "QUEST_NOT_ACTIVE" };
  }

  const item = (db.prepare(`SELECT id, quantity, stack_meta FROM inventory_items
    WHERE character_id = ? AND item_definition_id = ? ORDER BY id ASC`)
    .all(characterId, Number(active.required_item_definition_id)) as SqlRow[])
    .find((candidate) =>
      Number(candidate.quantity) >= Number(active.required_quantity ?? 1) &&
      isQuestBound(candidate.stack_meta, String(active.key)),
    );
  if (item === undefined) return { ok: false, reason: "QUEST_ITEM_MISSING" };

  const oldStamps = getStamps(characterId);
  const oldXp = getExperience(characterId);
  const nextXp = oldXp + Math.max(0, Number(active.xp_reward ?? 0));
  const levelRow = db.prepare("SELECT level, skill_points FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  let level = Number(levelRow?.level ?? 1);
  let skillPoints = Number(levelRow?.skill_points ?? 0);
  let threshold = level * 100;
  while (nextXp >= threshold) {
    level += 1;
    skillPoints += 1;
    threshold = level * 100;
  }
  const newStamps = oldStamps + Math.max(0, Number(active.stamp_reward ?? 0));

  db.exec("BEGIN");
  try {
    const quantity = Number(item.quantity) - Number(active.required_quantity ?? 1);
    if (quantity > 0) db.prepare("UPDATE inventory_items SET quantity = ? WHERE id = ?").run(quantity, Number(item.id));
    else db.prepare("DELETE FROM inventory_items WHERE id = ?").run(Number(item.id));
    db.prepare(`UPDATE character_quests SET state = 'completed', progress = ?, delivered_item_id = ?, completed_at = ?
      WHERE character_id = ? AND quest_id = ?`).run(JSON.stringify({ delivered: Number(active.required_quantity ?? 1) }), Number(item.id), new Date().toISOString(), characterId, Number(active.quest_id));
    db.prepare("UPDATE characters SET stamps = ?, experience = ?, level = ?, skill_points = ?, updated_at = ? WHERE id = ?")
      .run(newStamps, nextXp, level, skillPoints, new Date().toISOString(), characterId);
    if (active.reputation_reward_npc_id !== null && active.reputation_reward_npc_id !== undefined) {
      const npcId = String(active.reputation_reward_npc_id);
      const points = Math.max(0, Number(active.reputation_reward_points ?? 0));
      const current = db.prepare("SELECT points FROM friendships WHERE character_id = ? AND npc_id = ?").get(characterId, npcId) as SqlRow | undefined;
      const nextPoints = Number(current?.points ?? 0) + points;
      db.prepare(`INSERT INTO friendships (character_id, npc_id, level, points) VALUES (?, ?, ?, ?)
        ON CONFLICT(character_id, npc_id) DO UPDATE SET level = excluded.level, points = excluded.points, updated_at = CURRENT_TIMESTAMP`)
        .run(characterId, npcId, friendshipLevel(nextPoints), nextPoints);
    }
    db.prepare("INSERT INTO audit_economy_events (character_id, event_type, item_definition_id, quantity, balance_after, reason) VALUES (?, 'item_remove', ?, ?, ?, ?)")
      .run(characterId, Number(active.required_item_definition_id), -Number(active.required_quantity ?? 1), newStamps, `quest_delivery:${String(active.key)}`);
    db.prepare("INSERT INTO audit_economy_events (character_id, event_type, quantity, balance_after, reason) VALUES (?, 'quest_reward', ?, ?, ?)")
      .run(characterId, Number(active.stamp_reward ?? 0), newStamps, String(active.key));
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }

  const quests = await getQuestState(characterId);
  const completed = quests.find((entry) => entry.questId === String(active.key));
  return {
    ok: true,
    quest: completed ?? questSnapshotFromRow(active),
    quests,
    inventory: getQuestInventory(characterId),
    stamps: newStamps,
    xp: nextXp,
    message: `Delivery complete: ${String(active.title)}`,
  };
}

export function getQuestInventory(characterId: number): QuestInventoryItem[] {
  const rows = getDb().prepare(`SELECT i.id, i.slot, i.quantity, i.stack_meta, d.key
    FROM inventory_items i JOIN item_definitions d ON d.id = i.item_definition_id
   WHERE i.character_id = ? ORDER BY i.slot ASC, i.id ASC`).all(characterId) as SqlRow[];
  return rows.map((row) => ({
    itemInstanceId: Number(row.id),
    itemKey: String(row.key ?? ""),
    slot: row.slot === null ? null : Number(row.slot),
    quantity: Number(row.quantity ?? 1),
    locked: isLocked(row.stack_meta),
  }));
}

function ensureCharacterQuestRows(characterId: number): void {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO character_quests (character_id, quest_id, state, progress)
    SELECT ?, id, 'locked', ? FROM quest_definitions WHERE chain_position > 0`).run(characterId, JSON.stringify({ delivered: 0 }));
}

function refreshAvailableStates(characterId: number): void {
  const db = getDb();
  db.prepare(`UPDATE character_quests SET state = 'available'
    WHERE character_id = ? AND state = 'locked'
      AND NOT EXISTS (
        SELECT 1 FROM quest_prerequisites p
        LEFT JOIN character_quests done ON done.character_id = character_quests.character_id
          AND done.quest_id = p.prerequisite_id AND done.state = 'completed'
        WHERE p.quest_id = character_quests.quest_id AND p.prerequisite_kind = 'quest' AND done.quest_id IS NULL
      )`).run(characterId);
}

function findQuest(characterId: number, questId: string): SqlRow | null {
  const row = getDb().prepare(`SELECT q.id AS quest_id, q.key, q.title, q.description, q.type,
      q.giver_npc_id, q.delivery_target_npc_id, q.required_item_definition_id,
      q.required_quantity, q.stamp_reward, q.xp_reward, q.reputation_reward_npc_id,
      q.reputation_reward_points, q.chain_position, cq.state
    FROM quest_definitions q JOIN character_quests cq ON cq.quest_id = q.id
   WHERE cq.character_id = ? AND q.key = ? LIMIT 1`).get(characterId, questId) as SqlRow | undefined;
  return row ?? null;
}

function rowToQuest(row: SqlRow): QuestSnapshot {
  return {
    questId: String(row.key ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    type: String(row.type ?? "delivery"),
    giverId: String(row.giver_npc_id ?? ""),
    targetId: row.delivery_target_npc_id === null ? null : String(row.delivery_target_npc_id ?? ""),
    requiredItemId: row.required_item_key === null ? null : String(row.required_item_key ?? ""),
    requiredQuantity: Number(row.required_quantity ?? 1),
    state: normalizeState(row.state),
    progress: parseProgress(row.progress),
    stampReward: Number(row.stamp_reward ?? 0),
    xpReward: Number(row.xp_reward ?? 0),
    reputationNpcId: row.reputation_reward_npc_id === null ? null : String(row.reputation_reward_npc_id ?? ""),
    reputationPoints: Number(row.reputation_reward_points ?? 0),
    chainPosition: Number(row.chain_position ?? 0),
  };
}

function questSnapshotFromRow(row: SqlRow): QuestSnapshot {
  return rowToQuest({ ...row, required_item_key: null, progress: JSON.stringify({ delivered: 0 }) });
}

function normalizeState(raw: unknown): QuestState {
  return raw === "available" || raw === "active" || raw === "completed" ? raw : "locked";
}

function parseProgress(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  try { return Number((JSON.parse(raw) as { delivered?: unknown }).delivered ?? 0); } catch { return 0; }
}

function isLocked(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try { return (JSON.parse(raw) as { locked?: unknown }).locked === true; } catch { return false; }
}

function isQuestBound(raw: unknown, questId: string): boolean {
  if (typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw) as { locked?: unknown; questId?: unknown };
    return parsed.locked === true && parsed.questId === questId;
  } catch { return false; }
}

function friendshipLevel(points: number): number {
  if (points >= 18) return 4;
  if (points >= 12) return 3;
  if (points >= 7) return 2;
  if (points >= 3) return 1;
  return 0;
}

function getStamps(characterId: number): number {
  const row = getDb().prepare("SELECT stamps FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  return Number(row?.stamps ?? 0);
}

function getExperience(characterId: number): number {
  const row = getDb().prepare("SELECT experience FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  return Number(row?.experience ?? 0);
}
