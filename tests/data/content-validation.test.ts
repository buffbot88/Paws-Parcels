import { describe, expect, it } from "vitest";
import type { ContentData } from "../../src/types/ContentData.ts";
import { validateContent } from "../../src/systems/ContentValidator.ts";
import type { NPC } from "../../src/types/NPCtypes.ts";
import type { ItemDefinition } from "../../src/types/ItemTypes.ts";
import type { QuestDefinition } from "../../src/types/QuestTypes.ts";
import type { UpgradeDefinition } from "../../src/types/UpgradeTypes.ts";
import type { DialogueSet } from "../../src/types/DialogueTypes.ts";

// ---- Compile-time schema conformance (the JSON must satisfy the interfaces) ----
// TS widens string literals when importing JSON, so we widen the interface unions
// and `satisfies` still fails typecheck on any missing/renamed/retyped field.
type Widen<T> = T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends readonly (infer U)[] ? Widen<U>[]
  : T extends object ? { [K in keyof T]: Widen<T[K]> }
  : T;

import npcsJson from "../../src/data/npcs.json";
import itemsJson from "../../src/data/items.json";
import questsJson from "../../src/data/quests.json";
import upgradesJson from "../../src/data/upgrades.json";
import dialogueJson from "../../src/data/dialogue.json";

npcsJson satisfies { npcs: Widen<NPC>[] };
itemsJson satisfies { items: Widen<ItemDefinition>[] };
questsJson satisfies { quests: Widen<QuestDefinition>[] };
upgradesJson satisfies { upgrades: Widen<UpgradeDefinition>[] };
dialogueJson satisfies { dialogue: Widen<DialogueSet>[] };

const npcs = npcsJson as { npcs: Widen<NPC>[] };
const items = itemsJson as { items: Widen<ItemDefinition>[] };
const quests = questsJson as { quests: Widen<QuestDefinition>[] };
const upgrades = upgradesJson as { upgrades: Widen<UpgradeDefinition>[] };
const dialogue = dialogueJson as { dialogue: Widen<DialogueSet>[] };

function realContent(): ContentData {
  // Conformance to the strict interfaces is guaranteed by the `satisfies` checks above.
  return {
    npcs: npcs.npcs as unknown as NPC[],
    items: items.items as unknown as ItemDefinition[],
    quests: quests.quests as unknown as QuestDefinition[],
    upgrades: upgrades.upgrades as unknown as UpgradeDefinition[],
    dialogue: dialogue.dialogue as unknown as DialogueSet[],
  };
}

/** Minimal valid dataset used as the base for rule-level tests. */
function baseContent(): ContentData {
  return {
    npcs: [{ id: "npc-a", name: "A", species: "Fox", personality: "cheerful", role: "Tester", homeZone: "zone-clover-village", homeTile: { x: 5, y: 5 } }],
    items: [
      { id: "item-x", name: "X", description: "d", category: "resource", maxStack: 10, icon: "i" },
      { id: "item-gift", name: "Gift", description: "g", category: "gift", maxStack: 1, icon: "i" },
    ],
    quests: [{ id: "quest-1", title: "T", description: "d", type: "delivery", giverId: "npc-a", targetId: "npc-a", requiredItemId: "item-x", requiredQuantity: 1, stampReward: 10, daily: true }],
    upgrades: [{ id: "upgrade-1", name: "U", description: "d", cost: 50, effect: { type: "inventorySlots", value: 6 } }],
    dialogue: [{ id: "dialogue-1", npcId: "npc-a", minFriendship: 0, lines: ["hi"] }],
  };
}

describe("shipped content", () => {
  it("validates the real JSON content with zero errors", () => {
    const result = validateContent(realContent());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("has the expected MVP content counts", () => {
    const data = realContent();
    expect(data.npcs).toHaveLength(5);
    expect(data.items).toHaveLength(20);
    expect(data.quests).toHaveLength(19);
    expect(data.upgrades).toHaveLength(3);
    expect(data.dialogue).toHaveLength(6);
  });
});

describe("unique IDs", () => {
  it("rejects duplicate ids within a file", () => {
    const data = baseContent();
    data.npcs.push({ ...data.npcs[0] });
    const result = validateContent(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  it("rejects a record with a missing id", () => {
    const data = baseContent();
    data.npcs[0] = { ...data.npcs[0], id: "" };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects cross-file id collisions", () => {
    const data = baseContent();
    data.items[0] = { ...data.items[0], id: "npc-a" };
    expect(validateContent(data).errors.some((e) => e.includes("cross-file id collision"))).toBe(true);
  });
});

describe("NPC rules", () => {
  it("rejects an unknown homeZone", () => {
    const data = baseContent();
    data.npcs[0] = { ...data.npcs[0], homeZone: "zone-nowhere" as never };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects a homeTile outside the zone bounds", () => {
    const data = baseContent();
    data.npcs[0] = { ...data.npcs[0], homeTile: { x: 31, y: 5 } }; // clover village is 30x20
    expect(validateContent(data).errors.some((e) => e.includes("outside"))).toBe(true);
  });

  it("rejects a non-numeric homeTile", () => {
    const data = baseContent();
    data.npcs[0] = { ...data.npcs[0], homeTile: { x: 1, y: "two" as never } };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects a missing name", () => {
    const data = baseContent();
    data.npcs[0] = { ...data.npcs[0], name: "" };
    expect(validateContent(data).errors.some((e) => e.includes("missing name"))).toBe(true);
  });
});

describe("item rules", () => {
  it("rejects an unknown category", () => {
    const data = baseContent();
    data.items[0] = { ...data.items[0], category: "tool" as never };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects maxStack below 1", () => {
    const data = baseContent();
    data.items[0] = { ...data.items[0], maxStack: 0 };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects favoriteBy referencing an unknown npc", () => {
    const data = baseContent();
    data.items[0] = { ...data.items[0], favoriteBy: ["npc-missing"] };
    expect(validateContent(data).errors.some((e) => e.includes("favoriteBy"))).toBe(true);
  });
});

describe("quest rules", () => {
  it("rejects a giverId that is not a known npc", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], giverId: "npc-missing" };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects a requiredItemId that is not a known item", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], requiredItemId: "item-missing" };
    expect(validateContent(data).ok).toBe(false);
  });

  it("warns (not fails) when requiredItemId lacks requiredQuantity", () => {
    const data = baseContent();
    const quest = { ...data.quests[0] };
    delete (quest as Partial<QuestDefinition>).requiredQuantity;
    data.quests[0] = quest;
    const result = validateContent(data);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("no requiredQuantity"))).toBe(true);
  });

  it("requires findAt for errands with a requiredItemId", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], type: "errand" };
    expect(validateContent(data).errors.some((e) => e.includes("findAt"))).toBe(true);
  });

  it("rejects daily quests gated on friendship (impossible dailies)", () => {
    const data = baseContent();
    data.quests[0] = {
      ...data.quests[0],
      type: "errand",
      findAt: "the woods",
      requiresFriendship: { npcId: "npc-a", level: 2 },
      daily: true,
    };
    expect(validateContent(data).errors.some((e) => e.includes("daily quest cannot"))).toBe(true);
  });

  it("rejects rewardItemId that is not a known item", () => {
    const data = baseContent();
    data.quests[0] = {
      ...data.quests[0],
      requiredItemId: undefined,
      requiredQuantity: undefined,
      type: "errand",
      rewardItemId: "item-missing",
      requiresFriendship: { npcId: "npc-a", level: 4 },
      daily: false,
    };
    expect(validateContent(data).errors.some((e) => e.includes("rewardItemId"))).toBe(true);
  });

  it("rejects a resource/delivery item as a friendship reward", () => {
    const data = baseContent();
    data.quests[0] = {
      ...data.quests[0],
      requiredItemId: undefined,
      requiredQuantity: undefined,
      type: "errand",
      rewardItemId: "item-x",
      requiresFriendship: { npcId: "npc-a", level: 4 },
      daily: false,
    };
    expect(validateContent(data).errors.some((e) => e.includes("must be gift/cosmetic/quest"))).toBe(true);
  });

  it("rejects rewardItemId coexisting with requiredItemId/findAt", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], rewardItemId: "item-gift" };
    const result = validateContent(data);
    expect(result.errors.some((e) => e.includes("cannot coexist"))).toBe(true);
    // No unrelated category error — isolation.
    expect(result.errors.some((e) => e.includes("must be gift/cosmetic/quest"))).toBe(false);
  });

  it("warns when rewardItemId lacks a friendship gate", () => {
    const data = baseContent();
    data.quests[0] = {
      ...data.quests[0],
      requiredItemId: undefined,
      requiredQuantity: undefined,
      type: "errand",
      rewardItemId: "item-gift",
      requiresFriendship: undefined,
      daily: false,
    };
    const result = validateContent(data);
    expect(result.warnings.some((w) => w.includes("no requiresFriendship gate"))).toBe(true);
  });

  it("rejects non-positive stamp rewards", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], stampReward: 0 };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects a friendship gate with an out-of-range level", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], requiresFriendship: { npcId: "npc-a", level: 9 } };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects additionalStops referencing an unknown npc", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], additionalStops: ["npc-missing"] };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects a friendshipReward that can jump two levels from an ungated start", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], friendshipReward: 5, friendshipNpcId: "npc-a" }; // T[1]-1+5 = 7 >= T[2]
    expect(validateContent(data).errors.some((e) => e.includes("jump two levels"))).toBe(true);
  });

  it("rejects a friendshipReward that can jump two levels from a gated start", () => {
    const data = baseContent();
    data.quests[0] = {
      ...data.quests[0],
      friendshipReward: 7,
      friendshipNpcId: "npc-a",
      requiresFriendship: { npcId: "npc-a", level: 2 }, // T[3]-1+7 = 18 >= T[4]
      daily: false,
    };
    expect(validateContent(data).errors.some((e) => e.includes("jump two levels"))).toBe(true);
  });

  it("allows the max reward (+3) without jumping two levels", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], friendshipReward: 3, friendshipNpcId: "npc-a" };
    expect(validateContent(data).ok).toBe(true);
  });

  it("rejects a non-string findAt", () => {
    const data = baseContent();
    data.quests[0] = { ...data.quests[0], type: "errand", findAt: 42 as never };
    expect(validateContent(data).errors.some((e) => e.includes("findAt must be a string"))).toBe(true);
  });
});

describe("upgrade rules", () => {
  it("rejects a non-positive cost", () => {
    const data = baseContent();
    data.upgrades[0] = { ...data.upgrades[0], cost: 0 };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects an effect without a numeric value", () => {
    const data = baseContent();
    data.upgrades[0] = { ...data.upgrades[0], effect: { type: "speedMultiplier", value: "fast" as never } };
    expect(validateContent(data).ok).toBe(false);
  });
});

describe("dialogue rules", () => {
  it("rejects dialogue for an unknown npc", () => {
    const data = baseContent();
    data.dialogue[0] = { ...data.dialogue[0], npcId: "npc-missing" };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects a minFriendship outside 0-4", () => {
    const data = baseContent();
    data.dialogue[0] = { ...data.dialogue[0], minFriendship: 5 };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects maxFriendship below minFriendship", () => {
    const data = baseContent();
    data.dialogue[0] = { ...data.dialogue[0], minFriendship: 3, maxFriendship: 1 };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects empty dialogue line sets", () => {
    const data = baseContent();
    data.dialogue[0] = { ...data.dialogue[0], lines: [] };
    expect(validateContent(data).ok).toBe(false);
  });

  it("rejects an NPC with no dialogue set (Phase 3 interactability)", () => {
    const data = baseContent();
    data.npcs.push({
      id: "npc-silent",
      name: "Silent",
      species: "Owl",
      personality: "quiet",
      role: "Tester",
      homeZone: "zone-clover-village",
      homeTile: { x: 5, y: 5 },
    });
    const result = validateContent(data);
    expect(result.errors.some((e) => e.includes("has no dialogue set"))).toBe(true);
  });
});
