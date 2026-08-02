import type { ContentData } from "../types/ContentData.ts";
import type { ItemCategory } from "../types/ItemTypes.ts";
import type { QuestType } from "../types/QuestTypes.ts";
import type { ZoneId } from "../types/NPCtypes.ts";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** True when there are no errors. */
  ok: boolean;
}

const ZONE_DIMS: Record<ZoneId, { w: number; h: number }> = {
  "zone-post-office": { w: 30, h: 20 },
  "zone-bramble-patch": { w: 40, h: 26 },
};

const CATEGORIES: readonly ItemCategory[] = ["resource", "gift", "delivery", "quest", "cosmetic"];
const QUEST_TYPES: readonly QuestType[] = ["delivery", "gathering", "errand"];

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
    const dims = ZONE_DIMS[npc.homeZone];
    if (!dims) {
      fail(`npc ${npc.id}: unknown homeZone "${npc.homeZone}"`);
      continue;
    }
    if (!npc.homeTile || typeof npc.homeTile.x !== "number" || typeof npc.homeTile.y !== "number") {
      fail(`npc ${npc.id}: homeTile must have numeric x/y`);
      continue;
    }
    if (
      npc.homeTile.x < 0 || npc.homeTile.x >= dims.w ||
      npc.homeTile.y < 0 || npc.homeTile.y >= dims.h
    ) {
      fail(`npc ${npc.id}: homeTile (${npc.homeTile.x},${npc.homeTile.y}) outside ${npc.homeZone} (${dims.w}x${dims.h})`);
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
  }

  // ---- Quest checks ----
  for (const q of data.quests) {
    if (!QUEST_TYPES.includes(q.type)) fail(`quest ${q.id}: unknown type "${q.type}"`);
    if (!npcIds.has(q.giverId)) fail(`quest ${q.id}: giverId "${q.giverId}" is not a known npc`);
    if (q.targetId && !npcIds.has(q.targetId)) fail(`quest ${q.id}: targetId "${q.targetId}" is not a known npc`);
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
  for (const d of data.dialogue) {
    if (!npcIds.has(d.npcId)) fail(`dialogue ${d.id}: npcId "${d.npcId}" is not a known npc`);
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

  return { errors, warnings, ok: errors.length === 0 };
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
