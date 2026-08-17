import type { ContentData } from "../types/ContentData.ts";
import type { ItemCategory } from "../types/ItemTypes.ts";
import type { QuestDefinition, QuestType } from "../types/QuestTypes.ts";
import type { StaticContentData } from "../types/ContentData.ts";
import { MAP_DIMENSIONS } from "../game/Maps.ts";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** True when there are no errors. */
  ok: boolean;
}

const CATEGORIES: readonly ItemCategory[] = ["resource", "gift", "delivery", "quest", "cosmetic", "material", "equipment"];
const EQUIPMENT_SLOTS = ["head", "body", "weapon", "accessory", "boots", "courier-bag"] as const;
const QUEST_TYPES: readonly QuestType[] = ["delivery", "gathering", "errand"];

/**
 * Cumulative friendship points needed to reach each level (index = level, T[0] = 0).
 * Locked in design/decisions.md — user-approved. Do not change silently.
 */
export const FRIENDSHIP_THRESHOLDS: readonly number[] = [0, 3, 7, 12, 18];

/**
 * Validates content integrity: unique IDs, cross-references, and sane values.
 * Pure function — callers load data and pass it in.
 */
export function validateContent(data: ContentData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  const npcIds = assertUniqueIds(data.npcs.map((n) => n.id), "npcs.json", fail);
  const itemIds = assertUniqueIds(data.items.map((i) => i.id), "items.json", fail);
  const questIds = assertUniqueIds(data.quests.map((q) => q.id), "quests.json", fail);
  const upgradeIds = assertUniqueIds(data.upgrades.map((u) => u.id), "upgrades.json", fail);
  const dialogueIds = assertUniqueIds(data.dialogue.map((d) => d.id), "dialogue.json", fail);

  // Cross-file ID collision check (prefixes make this unlikely; guard anyway).
  const allIds = new Map<string, string>();
  for (const [ids, label] of [
    [npcIds, "npc"],
    [itemIds, "item"],
    [questIds, "quest"],
    [upgradeIds, "upgrade"],
    [dialogueIds, "dialogue"],
  ] as const) {
    for (const id of ids) {
      if (allIds.has(id)) fail(`cross-file id collision: "${id}" in ${label} and ${allIds.get(id)}`);
      allIds.set(id, label);
    }
  }

  // ---- NPC checks ----
  for (const npc of data.npcs) {
    if (!npc.name || typeof npc.name !== "string") fail(`npc ${npc.id}: missing name`);
    const dims = MAP_DIMENSIONS[npc.homeZone];
    if (!dims) {
      fail(`npc ${npc.id}: unknown homeZone "${npc.homeZone}"`);
      continue;
    }
    if (!npc.homeTile || typeof npc.homeTile.x !== "number" || typeof npc.homeTile.y !== "number") {
      fail(`npc ${npc.id}: homeTile must have numeric x/y`);
      continue;
    }
    if (
      npc.homeTile.x < 0 || npc.homeTile.x >= dims.width ||
      npc.homeTile.y < 0 || npc.homeTile.y >= dims.height
    ) {
      fail(`npc ${npc.id}: homeTile (${npc.homeTile.x},${npc.homeTile.y}) outside ${npc.homeZone} (${dims.width}x${dims.height})`);
    }
  }

  // ---- Item checks ----
  for (const item of data.items) {
    if (!CATEGORIES.includes(item.category)) {
      fail(`item ${item.id}: unknown category "${item.category}"`);
    }
    if (typeof item.maxStack !== "number" || item.maxStack < 1) {
      fail(`item ${item.id}: maxStack must be >= 1`);
    }
    if (item.favoriteBy) {
      for (const fav of item.favoriteBy) {
        if (!npcIds.has(fav)) fail(`item ${item.id}: favoriteBy references unknown npc "${fav}"`);
      }
    }
    if (item.category === "equipment") {
      if (item.equipmentSlot === undefined || !EQUIPMENT_SLOTS.includes(item.equipmentSlot)) {
        fail(`item ${item.id}: equipment must specify a valid equipmentSlot`);
      }
      for (const [label, values] of [["stats", item.stats], ["courierEffects", item.courierEffects]] as const) {
        if (values !== undefined && Object.values(values).some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
          fail(`item ${item.id}: ${label} values must be finite non-negative numbers`);
        }
      }
      if (item.requiredLevel !== undefined && (!Number.isInteger(item.requiredLevel) || item.requiredLevel < 1)) {
        fail(`item ${item.id}: requiredLevel must be a positive integer`);
      }
    } else if (item.equipmentSlot !== undefined || item.stats !== undefined || item.courierEffects !== undefined) {
      fail(`item ${item.id}: equipment metadata requires category equipment`);
    }
  }

  // ---- Quest checks ----
  for (const q of data.quests) {
    if (!QUEST_TYPES.includes(q.type)) fail(`quest ${q.id}: unknown type "${q.type}"`);
    if (!npcIds.has(q.giverId)) fail(`quest ${q.id}: giverId "${q.giverId}" is not a known npc`);
    if (q.targetId && !npcIds.has(q.targetId)) fail(`quest ${q.id}: targetId "${q.targetId}" is not a known npc`);
    if (q.parcelCondition !== undefined && !["normal", "fragile", "urgent"].includes(q.parcelCondition)) {
      fail(`quest ${q.id}: parcelCondition must be normal, fragile, or urgent`);
    }
    if (q.timeLimitSeconds !== undefined && (!Number.isFinite(q.timeLimitSeconds) || q.timeLimitSeconds <= 0)) {
      fail(`quest ${q.id}: timeLimitSeconds must be positive`);
    }
    if (q.breaksOnDefeat !== undefined && typeof q.breaksOnDefeat !== "boolean") {
      fail(`quest ${q.id}: breaksOnDefeat must be boolean`);
    }
    if (q.timeLimitSeconds !== undefined && q.parcelCondition !== "urgent") {
      fail(`quest ${q.id}: timeLimitSeconds requires an urgent parcelCondition`);
    }
    if (q.breaksOnDefeat === true && q.parcelCondition !== "fragile") {
      fail(`quest ${q.id}: breaksOnDefeat requires a fragile parcelCondition`);
    }
    for (const prerequisiteId of q.prerequisiteIds ?? []) {
      if (!questIds.has(prerequisiteId)) fail(`quest ${q.id}: prerequisiteIds references unknown quest "${prerequisiteId}"`);
    }
    for (const script of [q.acceptanceDialogue, q.completionDialogue]) {
      if (script === undefined) continue;
      if (!npcIds.has(script.speakerId)) fail(`quest ${q.id}: dialogue speakerId "${script.speakerId}" is not a known npc`);
      if (!Array.isArray(script.lines) || script.lines.length === 0 || script.lines.some((line) => typeof line !== "string" || line.trim() === "")) {
        fail(`quest ${q.id}: quest dialogue must contain non-empty lines`);
      }
    }
    if (q.requiredItemId && !itemIds.has(q.requiredItemId)) {
      fail(`quest ${q.id}: requiredItemId "${q.requiredItemId}" is not a known item`);
    }
    if (q.requiredItemId && !q.requiredQuantity) {
      warnings.push(`quest ${q.id}: requiredItemId set but no requiredQuantity (defaults to 1)`);
    }
    // Lost-item recovery quests must say where the item is found.
    if (q.type === "errand" && q.requiredItemId && !q.findAt) {
      fail(`quest ${q.id}: errand with requiredItemId must specify findAt (lost-item recovery location)`);
    }
    if (q.findAt && typeof q.findAt !== "string") fail(`quest ${q.id}: findAt must be a string`);
    if (q.searchObjectId !== undefined && typeof q.searchObjectId !== "string") fail(`quest ${q.id}: searchObjectId must be a string`);
    if (q.findAt && !q.searchObjectId) fail(`quest ${q.id}: findAt requires searchObjectId`);
    // Daily quests must never be blocked by a friendship gate (impossible-combination risk).
    if (q.daily && q.requiresFriendship) {
      fail(`quest ${q.id}: daily quest cannot have requiresFriendship (would generate impossible dailies)`);
    }
    // Friendship-reward quests hand out gift/cosmetic/quest items — never resources or delivery items.
    if (q.rewardItemId) {
      if (!itemIds.has(q.rewardItemId)) {
        fail(`quest ${q.id}: rewardItemId "${q.rewardItemId}" is not a known item`);
      } else {
        const reward = data.items.find((i) => i.id === q.rewardItemId);
        if (reward && (reward.category === "resource" || reward.category === "delivery")) {
          fail(`quest ${q.id}: rewardItemId "${q.rewardItemId}" must be gift/cosmetic/quest, not ${reward.category}`);
        }
      }
      // A reward quest must not also require the same (or any) item to find/hand in.
      if (q.requiredItemId || q.findAt) {
        fail(`quest ${q.id}: rewardItemId cannot coexist with requiredItemId/findAt`);
      }
      if (!q.requiresFriendship) {
        warnings.push(`quest ${q.id}: rewardItemId present but no requiresFriendship gate`);
      }
    }
    if (typeof q.stampReward !== "number" || q.stampReward <= 0) {
      fail(`quest ${q.id}: stampReward must be a positive number`);
    }
    // No two-level jump invariant: a single reward must never move a player up two levels.
    // Worst case = player at the top of the start level + reward. For gated quests the start
    // level is the gate; for ungated quests the tightest bound is the lowest level (0).
    if (typeof q.friendshipReward === "number" && q.friendshipReward > 0) {
      const startLevel = q.requiresFriendship ? q.requiresFriendship.level : 0;
      const topOfStart = FRIENDSHIP_THRESHOLDS[startLevel + 1] - 1;
      const twoUp = FRIENDSHIP_THRESHOLDS[startLevel + 2];
      if (twoUp !== undefined && topOfStart + q.friendshipReward >= twoUp) {
        fail(
          `quest ${q.id}: friendshipReward ${q.friendshipReward} can jump two levels ` +
          `(from level ${startLevel} top ${topOfStart} pts, level ${startLevel + 2} starts at ${twoUp})`
        );
      }
    }
    if (q.friendshipNpcId && !npcIds.has(q.friendshipNpcId)) {
      fail(`quest ${q.id}: friendshipNpcId "${q.friendshipNpcId}" is not a known npc`);
    }
    if (q.additionalStops) {
      for (const stop of q.additionalStops) {
        if (!npcIds.has(stop)) fail(`quest ${q.id}: additionalStop "${stop}" is not a known npc`);
      }
    }
    if (q.requiresFriendship) {
      const { npcId, level } = q.requiresFriendship;
      if (!npcIds.has(npcId)) fail(`quest ${q.id}: requiresFriendship.npcId "${npcId}" is not a known npc`);
      if (!Number.isInteger(level) || level < 0 || level > 4) {
        fail(`quest ${q.id}: requiresFriendship.level must be an integer 0-4`);
      }
    }
  }

  // ---- Upgrade checks ----
  for (const u of data.upgrades) {
    if (typeof u.cost !== "number" || u.cost <= 0) fail(`upgrade ${u.id}: cost must be a positive number`);
    if (!u.effect || typeof u.effect.value !== "number") fail(`upgrade ${u.id}: effect must include numeric value`);
  }

  // ---- Dialogue checks ----
  const dialogueNpcIds = new Set<string>();
  for (const d of data.dialogue) {
    if (!npcIds.has(d.npcId)) fail(`dialogue ${d.id}: npcId "${d.npcId}" is not a known npc`);
    dialogueNpcIds.add(d.npcId);
    if (typeof d.minFriendship !== "number" || d.minFriendship < 0 || d.minFriendship > 4) {
      fail(`dialogue ${d.id}: minFriendship must be an integer 0-4`);
    }
    if (!Array.isArray(d.lines) || d.lines.length === 0) fail(`dialogue ${d.id}: must have at least one line`);
    if (d.maxFriendship !== undefined) {
      if (typeof d.maxFriendship !== "number" || d.maxFriendship < d.minFriendship || d.maxFriendship > 4) {
        fail(`dialogue ${d.id}: maxFriendship must be >= minFriendship and <= 4`);
      }
    }
  }
  // Every NPC must be reachable by the dialogue system (Phase 3 interactability).
  for (const npc of data.npcs) {
    if (!dialogueNpcIds.has(npc.id)) {
      fail(`npc ${npc.id}: has no dialogue set in dialogue.json (Phase 3 interaction requires one)`);
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}

/** Validate the server-loaded catalogs that are not part of the NPC/quest bundle. */
export function validateStaticContent(data: StaticContentData, itemIds: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);
  const classKeys = assertUniqueIds(data.classes.map((entry) => entry.key), "classes.json", fail);
  const skillKeys = assertUniqueIds(data.skills.map((entry) => entry.skillKey), "skills.json", fail);
  const zoneKeys = assertUniqueIds(data.zones.map((entry) => entry.key), "zones.json", fail);
  const monsterKeys = assertUniqueIds(data.monsters.map((entry) => entry.key), "monsters.json", fail);
  for (const cls of data.classes) {
    if (cls.resourceMax <= 0 || cls.resourceRegenPerSec < 0) fail(`class ${cls.key}: resource values are invalid`);
    if (cls.baseStats.hp <= 0 || cls.baseStats.attack < 0 || cls.baseStats.defense < 0) fail(`class ${cls.key}: base stats are invalid`);
  }
  for (const skill of data.skills) {
    if (!classKeys.has(skill.classKey)) fail(`skill ${skill.skillKey}: unknown class "${skill.classKey}"`);
    if (skill.cost <= 0 || skill.requiredLevel < 1) fail(`skill ${skill.skillKey}: cost/requiredLevel are invalid`);
    if (skill.prerequisiteKey !== null && !skillKeys.has(skill.prerequisiteKey)) fail(`skill ${skill.skillKey}: unknown prerequisite "${skill.prerequisiteKey}"`);
  }
  for (const zone of data.zones) {
    if (zone.widthTiles <= 0 || zone.heightTiles <= 0 || zone.maxPlayers <= 0) fail(`zone ${zone.key}: dimensions/capacity are invalid`);
    if (!Number.isInteger(zone.defaultSpawn.x) || !Number.isInteger(zone.defaultSpawn.y)) fail(`zone ${zone.key}: defaultSpawn must be integer coordinates`);
  }
  for (const monster of data.monsters) {
    if (!zoneKeys.has(monster.zoneKey)) fail(`monster ${monster.key}: unknown zone "${monster.zoneKey}"`);
    if (monster.levelMin < 1 || monster.levelMax < monster.levelMin || monster.maxHp <= 0) fail(`monster ${monster.key}: level/HP values are invalid`);
    for (const loot of monster.lootTable) {
      if (!itemIds.has(loot.key)) fail(`monster ${monster.key}: loot references unknown item "${loot.key}"`);
      if (loot.chance < 0 || loot.chance > 1 || loot.quantity < 1) fail(`monster ${monster.key}: loot entry "${loot.key}" has invalid chance/quantity`);
    }
  }
  return { errors, warnings: [], ok: errors.length === 0 };
}

/**
 * Every quest's searchObjectId must reference a real map interactable.
 * Shipped quests (server filter: chainPosition>0 or phase "4B") error on a
 * dangling reference; quests the server filters out only warn, since they
 * cannot be played anyway.
 */
export function validateQuestSearchObjects(
  quests: readonly QuestDefinition[],
  interactableIds: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const q of quests) {
    if (q.searchObjectId === undefined) continue;
    if (interactableIds.has(q.searchObjectId)) continue;
    const shipped = (q.chainPosition ?? 0) > 0 || q.phase === "4B";
    const msg = `quest ${q.id}: searchObjectId "${q.searchObjectId}" is not a known map interactable`;
    if (shipped) errors.push(msg);
    else warnings.push(`${msg} (quest is not currently shipped)`);
  }
  return { errors, warnings, ok: errors.length === 0 };
}

/** Minimal map shape the parity checks need (avoids importing the full MapData). */
interface ParityMap {
  width: number;
  height: number;
  spawn: { x: number; y: number };
  monsterSpawns?: { id: string; key: string }[];
}

/**
 * zones.json dimensions/spawn must match the client map files — the server
 * builds collision from the map while clients render from zones.json, so a
 * drift desyncs movement validation from what players see.
 */
export function validateZoneMapParity(
  zones: readonly { key: string; widthTiles: number; heightTiles: number; defaultSpawn: { x: number; y: number } }[],
  maps: Readonly<Record<string, ParityMap>>,
): ValidationResult {
  const errors: string[] = [];
  for (const zone of zones) {
    const map = maps[zone.key];
    if (map === undefined) {
      errors.push(`zone ${zone.key}: no client map registered for this key`);
      continue;
    }
    if (zone.widthTiles !== map.width || zone.heightTiles !== map.height) {
      errors.push(`zone ${zone.key}: zones.json ${zone.widthTiles}x${zone.heightTiles} != map ${map.width}x${map.height}`);
    }
    if (zone.defaultSpawn.x !== map.spawn.x || zone.defaultSpawn.y !== map.spawn.y) {
      errors.push(`zone ${zone.key}: zones.json spawn (${zone.defaultSpawn.x},${zone.defaultSpawn.y}) != map spawn (${map.spawn.x},${map.spawn.y})`);
    }
  }
  return { errors, warnings: [], ok: errors.length === 0 };
}

/** Every map monster-spawn key must reference a defined monster in monsters.json. */
export function validateMonsterSpawnKeys(
  maps: Readonly<Record<string, ParityMap>>,
  monsterKeys: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = [];
  for (const [zoneId, map] of Object.entries(maps)) {
    for (const spawn of map.monsterSpawns ?? []) {
      if (!monsterKeys.has(spawn.key)) {
        errors.push(`${zoneId}: monster spawn "${spawn.id}" references unknown monster key "${spawn.key}"`);
      }
    }
  }
  return { errors, warnings: [], ok: errors.length === 0 };
}

function assertUniqueIds(ids: string[], file: string, fail: (msg: string) => void): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !id) {
      fail(`${file}: record missing string id`);
      continue;
    }
    if (seen.has(id)) fail(`${file}: duplicate id "${id}"`);
    seen.add(id);
  }
  return seen;
}
