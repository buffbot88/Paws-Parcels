import questsJson from "../../../src/data/quests.json" with { type: "json" };
import { getDb } from "../db/connection.ts";
import { getEffectiveSlotCount, getInventoryState } from "./Equipment.ts";
import { applyExperience } from "./leveling.ts";
import { isShippedQuest } from "./questFilter.ts";
import { getGameplayRates } from "./GameplayRates.ts";

type SqlRow = Record<string, unknown>;

type ParcelCondition = "normal" | "fragile" | "urgent";

type QuestContent = {
  id: string;
  phase?: "4B";
  title: string;
  description: string;
  type: string;
  giverId: string;
  targetId?: string;
  requiredItemId?: string;
  requiredQuantity?: number;
  findAt?: string;
  searchObjectId?: string;
  rewardItemId?: string;
  requiresFriendship?: { npcId: string; level: number };
  stampReward: number;
  xpReward?: number;
  friendshipNpcId?: string;
  friendshipReward?: number;
  reputationPoints?: number;
  chainPosition?: number;
  prerequisiteIds?: string[];
  courierRankReward?: string;
  timeLimitSeconds?: number;
  breaksOnDefeat?: boolean;
  parcelCondition?: ParcelCondition;
};

const CONTENT_QUESTS: QuestContent[] = (questsJson.quests as QuestContent[])
  .filter(isShippedQuest);
const TUTORIAL_QUESTS: QuestContent[] = CONTENT_QUESTS
  .filter((quest) => (quest.chainPosition ?? 0) > 0)
  .sort((left, right) => (left.chainPosition ?? 0) - (right.chainPosition ?? 0));
const SIDE_QUESTS: QuestContent[] = CONTENT_QUESTS
  .filter((quest) => (quest.chainPosition ?? 0) === 0);

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
  parcelCondition: ParcelCondition;
  deadlineAt: number | null;
  sideQuest: boolean;
  findAt: string | null;
  searchObjectId: string | null;
  rewardItemId: string | null;
  friendshipGate: { npcId: string; level: number } | null;
}

export interface QuestInventoryItem {
  itemInstanceId: number;
  itemKey: string;
  slot: number | null;
  quantity: number;
  locked: boolean;
}

/**
 * Post-grant courier progression, attached to deliveries only.
 *
 * `xp` on the mutation result is the character's new *total* XP, which is not
 * the same thing as its level: the client cannot tell a level-up happened, or
 * to what, without the server doing the arithmetic it already did. These are
 * the authoritative values the delivery just wrote, so the HUD can present a
 * level-up (and a rank promotion) without recomputing the curve.
 */
export interface QuestProgression {
  level: number;
  /** Level before the grant — the server already had it, so the client needn't. */
  previousLevel: number;
  /** Levels crossed by this grant (0 when a delivery awards no level). */
  levelsGained: number;
  experience: number;
  skillPoints: number;
  /** Rank after the grant — the promoted rank, or the one already held. */
  courierRank: string;
  /**
   * The rank this delivery promoted the courier to, or null. Explicit rather
   * than a comparison: a client that only just connected has no previous rank
   * to compare against, and guessing "Trainee" would fake a promotion for a
   * returning courier on their first delivery.
   */
  rankPromotion: string | null;
}

export type QuestMutationResult =
  | { ok: true; quest: QuestSnapshot; quests: QuestSnapshot[]; inventory: QuestInventoryItem[]; stamps: number; xp: number; message: string; progression?: QuestProgression }
  | { ok: false; reason: "QUEST_NOT_AVAILABLE" | "QUEST_PREREQUISITES_NOT_MET" | "QUEST_ALREADY_ACTIVE" | "QUEST_ALREADY_COMPLETE" | "INVENTORY_FULL" | "QUEST_NOT_ACTIVE" | "QUEST_ITEM_MISSING" | "WRONG_DELIVERY_TARGET" };

/** Return the JSON-defined tutorial chain and make its initial state available. */
export async function getQuestState(characterId: number): Promise<QuestSnapshot[]> {
  ensureCharacterQuestRows(characterId);
  expireUrgentDeliveries(characterId);
  refreshAvailableStates(characterId);
  const rows = getDb().prepare(`
    SELECT quest_key, state, progress, accepted_at
      FROM character_quest_progress
     WHERE character_id = ?`).all(characterId) as SqlRow[];
  const byKey = new Map(rows.map((row) => [String(row.quest_key), row]));
  return [...TUTORIAL_QUESTS, ...SIDE_QUESTS].map((quest) => rowToQuest(quest, byKey.get(quest.id)));
}

/** Accept a JSON-defined tutorial quest and create its locked parcel. */
export async function acceptQuest(characterId: number, questId: string): Promise<QuestMutationResult> {
  ensureCharacterQuestRows(characterId);
  expireUrgentDeliveries(characterId);
  refreshAvailableStates(characterId);
  const quest = findQuestContent(questId);
  const state = quest === null ? null : getQuestProgress(characterId, quest.id);
  if (quest === null || state === null) return { ok: false, reason: "QUEST_NOT_AVAILABLE" };
  if (state.state === "active") return { ok: false, reason: "QUEST_ALREADY_ACTIVE" };
  if (state.state === "completed") return { ok: false, reason: "QUEST_ALREADY_COMPLETE" };
  if (getDb().prepare("SELECT 1 FROM character_quest_progress WHERE character_id = ? AND state = 'active' LIMIT 1").get(characterId) !== undefined) {
    return { ok: false, reason: "QUEST_ALREADY_ACTIVE" };
  }
  if (state.state !== "available") return { ok: false, reason: "QUEST_PREREQUISITES_NOT_MET" };

  const db = getDb();
  db.exec("BEGIN");
  try {
    if (quest.type === "delivery") {
      // Archived items (admin panel) can no longer satisfy a quest hand-in.
      const item = db.prepare("SELECT id FROM item_definitions WHERE key = ? AND is_deleted = 0 LIMIT 1").get(quest.requiredItemId ?? "") as SqlRow | undefined;
      if (item === undefined || !insertInventoryItem(characterId, Number(item.id), 1, { questId: quest.id, locked: true, condition: quest.parcelCondition ?? "normal" })) {
        db.exec("ROLLBACK");
        return { ok: false, reason: item === undefined ? "QUEST_ITEM_MISSING" : "INVENTORY_FULL" };
      }
    }
    db.prepare("UPDATE character_quest_progress SET state = 'active', progress = ?, accepted_at = ? WHERE character_id = ? AND quest_key = ?")
      .run(JSON.stringify({ delivered: 0, found: 0 }), new Date().toISOString(), characterId, quest.id);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }

  const quests = await getQuestState(characterId);
  const updated = quests.find((entry) => entry.questId === quest.id) as QuestSnapshot;
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

/** Complete the active JSON-defined delivery for the NPC being interacted with. */
export async function completeDelivery(characterId: number, targetNpcId: string): Promise<QuestMutationResult> {
  ensureCharacterQuestRows(characterId);
  expireUrgentDeliveries(characterId);
  const activeRows = getDb().prepare(`
    SELECT quest_key, state, accepted_at
      FROM character_quest_progress
     WHERE character_id = ? AND state = 'active'
     ORDER BY quest_key ASC`).all(characterId) as SqlRow[];
  const activeEntry = activeRows
    .map((row) => ({ quest: findQuestContent(String(row.quest_key)), state: row }))
    .find((entry) => entry.quest?.targetId === targetNpcId);
  if (activeEntry?.quest == null) {
    return { ok: false, reason: activeRows.length > 0 ? "WRONG_DELIVERY_TARGET" : "QUEST_NOT_ACTIVE" };
  }
  const active = activeEntry.quest;
  const requiredQuantity = Math.max(1, active.requiredQuantity ?? 1);
  const itemDefinition = active.requiredItemId === undefined
    ? undefined
    : getDb().prepare("SELECT id FROM item_definitions WHERE key = ? AND is_deleted = 0 LIMIT 1").get(active.requiredItemId) as SqlRow | undefined;
  if (active.requiredItemId !== undefined && itemDefinition === undefined) return { ok: false, reason: "QUEST_ITEM_MISSING" };
  const item = itemDefinition === undefined
    ? undefined
    : (getDb().prepare(`SELECT id, quantity, stack_meta FROM inventory_items
      WHERE character_id = ? AND item_definition_id = ? ORDER BY id ASC`)
      .all(characterId, Number(itemDefinition.id)) as SqlRow[])
      .find((candidate) =>
        Number(candidate.quantity) >= requiredQuantity &&
        (active.type === "delivery" ? isQuestBound(candidate.stack_meta, active.id) : !isLocked(candidate.stack_meta)),
      );
  if (active.requiredItemId !== undefined && item === undefined) return { ok: false, reason: "QUEST_ITEM_MISSING" };

  const oldStamps = getStamps(characterId);
  const oldXp = getExperience(characterId);
  // exp_rate server setting (spec §59) scales quest XP rewards too; admin
  // EXP adjustments intentionally bypass it (they are explicit amounts).
  const xpReward = Math.round((active.xpReward ?? 0) * getGameplayRates().expRate);
  const nextXp = oldXp + Math.max(0, xpReward);
  const levelRow = getDb().prepare("SELECT level, skill_points FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  const previousLevel = Number(levelRow?.level ?? 1);
  const { level, skillPoints } = applyExperience(
    Number(levelRow?.level ?? 1),
    Number(levelRow?.skill_points ?? 0),
    nextXp,
  );
  const newStamps = oldStamps + Math.max(0, active.stampReward);
  const rankReward = active.courierRankReward ?? null;
  const reputationNpcId = active.friendshipNpcId ?? null;
  const reputationPoints = Math.max(0, active.reputationPoints ?? active.friendshipReward ?? 0);

  const db = getDb();
  db.exec("BEGIN");
  try {
    if (item !== undefined) {
      const quantity = Number(item.quantity) - requiredQuantity;
      if (quantity > 0) db.prepare("UPDATE inventory_items SET quantity = ? WHERE id = ?").run(quantity, Number(item.id));
      else db.prepare("DELETE FROM inventory_items WHERE id = ?").run(Number(item.id));
    }
    let rewardItemDefinitionId: number | null = null;
    if (active.rewardItemId !== undefined) {
      const reward = db.prepare("SELECT id FROM item_definitions WHERE key = ? AND is_deleted = 0 LIMIT 1").get(active.rewardItemId) as SqlRow | undefined;
      if (reward === undefined || !insertInventoryItem(characterId, Number(reward.id), 1, { questReward: active.id })) {
        db.exec("ROLLBACK");
        return { ok: false, reason: reward === undefined ? "QUEST_ITEM_MISSING" : "INVENTORY_FULL" };
      }
      rewardItemDefinitionId = Number(reward.id);
    }
    db.prepare(`UPDATE character_quest_progress SET state = 'completed', progress = ?, delivered_item_id = ?, completed_at = ?
      WHERE character_id = ? AND quest_key = ?`).run(JSON.stringify({ delivered: requiredQuantity }), item === undefined ? null : Number(item.id), new Date().toISOString(), characterId, active.id);
    db.prepare("UPDATE characters SET stamps = ?, experience = ?, level = ?, skill_points = ?, courier_rank = COALESCE(?, courier_rank), updated_at = ? WHERE id = ?")
      .run(newStamps, nextXp, level, skillPoints, rankReward, new Date().toISOString(), characterId);
    if (reputationNpcId !== null && reputationPoints > 0) {
      const current = db.prepare("SELECT points FROM friendships WHERE character_id = ? AND npc_id = ?").get(characterId, reputationNpcId) as SqlRow | undefined;
      const nextPoints = Number(current?.points ?? 0) + reputationPoints;
      db.prepare(`INSERT INTO friendships (character_id, npc_id, level, points) VALUES (?, ?, ?, ?)
        ON CONFLICT(character_id, npc_id) DO UPDATE SET level = excluded.level, points = excluded.points, updated_at = CURRENT_TIMESTAMP`)
        .run(characterId, reputationNpcId, friendshipLevel(nextPoints), nextPoints);
    }
    if (itemDefinition !== undefined && item !== undefined) {
      db.prepare("INSERT INTO audit_economy_events (character_id, event_type, item_definition_id, quantity, balance_after, reason) VALUES (?, 'item_remove', ?, ?, ?, ?)")
        .run(characterId, Number(itemDefinition.id), -requiredQuantity, newStamps, `quest_${active.type}:${active.id}`);
    }
    if (rewardItemDefinitionId !== null) {
      db.prepare("INSERT INTO audit_economy_events (character_id, event_type, item_definition_id, quantity, balance_after, reason) VALUES (?, 'item_grant', ?, ?, ?, ?)")
        .run(characterId, rewardItemDefinitionId, 1, newStamps, `quest_reward_item:${active.id}`);
    }
    db.prepare("INSERT INTO audit_economy_events (character_id, event_type, quantity, balance_after, reason) VALUES (?, 'quest_reward', ?, ?, ?)")
      .run(characterId, active.stampReward, newStamps, active.id);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }

  const quests = await getQuestState(characterId);
  const completed = quests.find((entry) => entry.questId === active.id) as QuestSnapshot;
  const rankRow = getDb().prepare("SELECT courier_rank FROM characters WHERE id = ?").get(characterId) as SqlRow | undefined;
  return {
    ok: true,
    quest: completed,
    quests,
    inventory: getQuestInventory(characterId),
    stamps: newStamps,
    xp: nextXp,
    progression: {
      level,
      previousLevel,
      levelsGained: Math.max(0, level - previousLevel),
      experience: nextXp,
      skillPoints,
      courierRank: rankReward ?? String(rankRow?.courier_rank ?? "Trainee"),
      rankPromotion: rankReward,
    },
    message: rankReward !== null
      ? `Delivery complete: ${active.title} — you are now an official ${rankReward}!`
      : `Delivery complete: ${active.title}`,
  };
}

/** Search an authored map object for the active errand/gathering objective. */
export async function searchQuest(characterId: number, objectId: string): Promise<QuestMutationResult> {
  ensureCharacterQuestRows(characterId);
  const activeRows = getDb().prepare(`SELECT quest_key FROM character_quest_progress WHERE character_id = ? AND state = 'active'`).all(characterId) as SqlRow[];
  const active = activeRows.map((row) => findQuestContent(String(row.quest_key))).find((quest) => quest?.searchObjectId === objectId);
  if (active === undefined || active === null) return { ok: false, reason: "QUEST_NOT_ACTIVE" };
  const progress = getQuestProgress(characterId, active.id);
  if (progress !== null && hasFoundObjective(progress.progress)) return { ok: false, reason: "QUEST_ALREADY_ACTIVE" };
  if (active.requiredItemId === undefined) return { ok: false, reason: "QUEST_ITEM_MISSING" };
  const item = getDb().prepare("SELECT id FROM item_definitions WHERE key = ? AND is_deleted = 0 LIMIT 1").get(active.requiredItemId) as SqlRow | undefined;
  if (item === undefined) return { ok: false, reason: "QUEST_ITEM_MISSING" };
  const db = getDb();
  db.exec("BEGIN");
  try {
    if (!insertInventoryItem(characterId, Number(item.id), Math.max(1, active.requiredQuantity ?? 1), { questId: active.id, foundAt: active.findAt ?? objectId })) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "INVENTORY_FULL" };
    }
    db.prepare("UPDATE character_quest_progress SET progress = ? WHERE character_id = ? AND quest_key = ?")
      .run(JSON.stringify({ delivered: 0, found: Math.max(1, active.requiredQuantity ?? 1) }), characterId, active.id);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }
  const quests = await getQuestState(characterId);
  const updated = quests.find((quest) => quest.questId === active.id) as QuestSnapshot;
  return {
    ok: true,
    quest: updated,
    quests,
    inventory: getQuestInventory(characterId),
    stamps: getStamps(characterId),
    xp: getExperience(characterId),
    message: `Found ${active.title} objective at ${active.findAt ?? objectId}. Return it to ${active.targetId?.replace("npc-", "") ?? "the quest giver"}.`,
  };
}

/** Reset fragile routes after a defeat without penalizing the courier's main progression. */
export function resetFragileDeliveriesOnDefeat(characterId: number): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT quest_key FROM character_quest_progress WHERE character_id = ? AND state = 'active'").all(characterId) as SqlRow[];
  const reset: string[] = [];
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const quest = findQuestContent(String(row.quest_key));
      if (quest?.breaksOnDefeat !== true) continue;
      // A courier bag with fragileProtection keeps the bound parcel intact
      // through defeat; the protection is an authored gear effect, not a
      // client-side exception.
      if (getInventoryState(characterId).stats.fragileProtection > 0) continue;
      deleteBoundParcel(characterId, quest.id);
      db.prepare(`UPDATE character_quest_progress
        SET state = 'available', progress = ?, accepted_at = NULL, delivered_item_id = NULL
        WHERE character_id = ? AND quest_key = ?`)
        .run(JSON.stringify({ delivered: 0, resetReason: "defeat" }), characterId, quest.id);
      reset.push(quest.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }
  return reset;
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

function expireUrgentDeliveries(characterId: number): void {
  const db = getDb();
  const rows = db.prepare("SELECT quest_key, accepted_at FROM character_quest_progress WHERE character_id = ? AND state = 'active'").all(characterId) as SqlRow[];
  const expired = rows.filter((row) => {
    const quest = findQuestContent(String(row.quest_key));
    const acceptedAt = typeof row.accepted_at === "string" ? acceptedAtMs(row.accepted_at) : 0;
    return quest?.timeLimitSeconds !== undefined && acceptedAt > 0 && Date.now() >= acceptedAt + quest.timeLimitSeconds * 1000;
  });
  if (expired.length === 0) return;
  db.exec("BEGIN");
  try {
    for (const row of expired) {
      const questId = String(row.quest_key);
      deleteBoundParcel(characterId, questId);
      db.prepare(`UPDATE character_quest_progress
        SET state = 'available', progress = ?, accepted_at = NULL, delivered_item_id = NULL
        WHERE character_id = ? AND quest_key = ?`)
        .run(JSON.stringify({ delivered: 0, resetReason: "expired" }), characterId, questId);
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw err;
  }
}

function deleteBoundParcel(characterId: number, questId: string): void {
  const db = getDb();
  const items = db.prepare("SELECT id, stack_meta FROM inventory_items WHERE character_id = ?").all(characterId) as SqlRow[];
  for (const item of items) {
    if (isQuestBound(item.stack_meta, questId)) {
      db.prepare("DELETE FROM inventory_items WHERE id = ?").run(Number(item.id));
    }
  }
}

function acceptedAtMs(raw: string): number {
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureCharacterQuestRows(characterId: number): void {
  const db = getDb();
  if (CONTENT_QUESTS.length === 0) return;
  // One batched INSERT OR IGNORE instead of N per-character row writes —
  // getQuestState runs on every join/interact, so N writes per call would
  // dominate the quest path for no benefit once rows exist.
  const placeholders = CONTENT_QUESTS.map(() => "(?, ?, 'locked', ?)").join(",");
  const values: (string | number)[] = [];
  for (const quest of CONTENT_QUESTS) {
    values.push(characterId, quest.id, JSON.stringify({ delivered: 0, found: 0 }));
  }
  db.prepare(`INSERT OR IGNORE INTO character_quest_progress
    (character_id, quest_key, state, progress) VALUES ${placeholders}`)
    .run(...values);
}

function refreshAvailableStates(characterId: number): void {
  const db = getDb();
  const rows = db.prepare("SELECT quest_key, state FROM character_quest_progress WHERE character_id = ?").all(characterId) as SqlRow[];
  const states = new Map(rows.map((row) => [String(row.quest_key), normalizeState(row.state)]));
  const tutorialComplete = TUTORIAL_QUESTS.every((quest) => states.get(quest.id) === "completed");
  // Compute the full unlock set first, then apply it with a single UPDATE … IN
  // instead of one UPDATE per newly-available quest (same gate logic).
  const toUnlock: string[] = [];
  for (const quest of CONTENT_QUESTS) {
    if (states.get(quest.id) !== "locked") continue;
    const prerequisitesMet = (quest.prerequisiteIds ?? []).every((id) => states.get(id) === "completed");
    const tutorialGateMet = (quest.chainPosition ?? 0) > 0 || tutorialComplete;
    const friendshipGate = quest.requiresFriendship;
    const friendshipMet = friendshipGate === undefined || getFriendshipLevel(characterId, friendshipGate.npcId) >= friendshipGate.level;
    if (prerequisitesMet && tutorialGateMet && friendshipMet) toUnlock.push(quest.id);
  }
  if (toUnlock.length === 0) return;
  const placeholders = toUnlock.map(() => "?").join(",");
  db.prepare(`UPDATE character_quest_progress SET state = 'available'
    WHERE character_id = ? AND quest_key IN (${placeholders}) AND state = 'locked'`)
    .run(characterId, ...toUnlock);
}

function findQuestContent(questId: string): QuestContent | null {
  return CONTENT_QUESTS.find((quest) => quest.id === questId) ?? null;
}

function getQuestProgress(characterId: number, questKey: string): SqlRow | null {
  const row = getDb().prepare("SELECT quest_key, state, progress FROM character_quest_progress WHERE character_id = ? AND quest_key = ? LIMIT 1").get(characterId, questKey) as SqlRow | undefined;
  return row ?? null;
}

function rowToQuest(quest: QuestContent, row: SqlRow | undefined): QuestSnapshot {
  return {
    questId: quest.id,
    title: quest.title,
    description: quest.description,
    type: quest.type,
    giverId: quest.giverId,
    targetId: quest.targetId ?? null,
    requiredItemId: quest.requiredItemId ?? null,
    requiredQuantity: Math.max(1, quest.requiredQuantity ?? 1),
    state: normalizeState(row?.state),
    progress: parseProgress(row?.progress),
    stampReward: quest.stampReward,
    xpReward: Math.max(0, quest.xpReward ?? 0),
    reputationNpcId: quest.friendshipNpcId ?? null,
    reputationPoints: Math.max(0, quest.reputationPoints ?? quest.friendshipReward ?? 0),
    chainPosition: quest.chainPosition ?? 0,
    parcelCondition: normalizeParcelCondition(quest.parcelCondition),
    deadlineAt: quest.timeLimitSeconds !== undefined && typeof row?.accepted_at === "string"
      ? acceptedAtMs(row.accepted_at) + quest.timeLimitSeconds * 1000
      : null,
    sideQuest: (quest.chainPosition ?? 0) === 0,
    findAt: quest.findAt ?? null,
    searchObjectId: quest.searchObjectId ?? null,
    rewardItemId: quest.rewardItemId ?? null,
    friendshipGate: quest.requiresFriendship ?? null,
  };
}

function normalizeParcelCondition(raw: unknown): ParcelCondition {
  return raw === "fragile" || raw === "urgent" ? raw : "normal";
}

function normalizeState(raw: unknown): QuestState {
  return raw === "available" || raw === "active" || raw === "completed" ? raw : "locked";
}

function parseProgress(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  try {
    const parsed = JSON.parse(raw) as { delivered?: unknown; found?: unknown };
    return Math.max(Number(parsed.delivered ?? 0) || 0, Number(parsed.found ?? 0) || 0);
  } catch { return 0; }
}

function hasFoundObjective(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try { return Number((JSON.parse(raw) as { found?: unknown }).found ?? 0) > 0; } catch { return false; }
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

function getFriendshipLevel(characterId: number, npcId: string): number {
  const row = getDb().prepare("SELECT level FROM friendships WHERE character_id = ? AND npc_id = ?").get(characterId, npcId) as SqlRow | undefined;
  return Number(row?.level ?? 0);
}

/** Add an unlocked or quest-bound item to the first free inventory slot. */
function insertInventoryItem(characterId: number, itemDefinitionId: number, quantity: number, meta: Record<string, unknown>): boolean {
  const db = getDb();
  const slotCount = getEffectiveSlotCount(characterId);
  const used = new Set((db.prepare("SELECT slot FROM inventory_items WHERE character_id = ? AND slot IS NOT NULL").all(characterId) as SqlRow[]).map((row) => Number(row.slot)));
  let slot: number | null = null;
  for (let candidate = 0; candidate < slotCount; candidate += 1) {
    if (!used.has(candidate)) { slot = candidate; break; }
  }
  if (slot === null) return false;
  db.prepare(`INSERT INTO inventory_items
    (character_id, item_definition_id, slot, quantity, stack_meta)
    VALUES (?, ?, ?, ?, ?)`).run(characterId, itemDefinitionId, slot, Math.max(1, quantity), JSON.stringify(meta));
  return true;
}
