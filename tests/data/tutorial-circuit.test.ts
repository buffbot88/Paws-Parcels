import { describe, expect, it } from "vitest";

import questContent from "../../src/data/quests.json";
import itemContent from "../../src/data/items.json";
import { applyExperience } from "../../server/src/models/leveling.ts";

/**
 * The onboarding loop is authored content, so it is pinned here rather than only
 * through the server: one welcome letter, carried to all five main villagers,
 * with rewards tuned to land a new courier on level 5. If any of this drifts, the
 * tutorial silently stops matching the design in `design/quests.md` §6.
 */

const WELCOME_LETTER = "item-village-welcome-card";
const MAIN_VILLAGERS = ["npc-pip", "npc-biscuit", "npc-maple", "npc-lumi", "npc-moss"];

type Quest = (typeof questContent.quests)[number];
type Item = (typeof itemContent.items)[number];

const tutorial = questContent.quests
  .filter((quest): quest is Quest => (quest.chainPosition ?? 0) > 0)
  .sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0));

describe("Clover Village welcome-letter circuit", () => {
  it("is a five-leg chain that walks one welcome letter around the village", () => {
    expect(tutorial.map((quest) => quest.id)).toEqual([
      "quest-village-welcome",
      "quest-fresh-bread-biscuit",
      "quest-flower-note-maple",
      "quest-moon-note-lumi",
      "quest-garden-greeting-moss",
    ]);
    expect(tutorial.map((quest) => quest.chainPosition)).toEqual([1, 2, 3, 4, 5]);
    for (const [index, quest] of tutorial.entries()) {
      expect(quest.type).toBe("delivery");
      expect(quest.requiredItemId).toBe(WELCOME_LETTER);
      expect(quest.requiredQuantity).toBe(1);
      const previous = tutorial[index - 1];
      expect(quest.prerequisiteIds ?? []).toEqual(previous ? [previous.id] : []);
    }
  });

  it("visits all five main villagers and returns the letter to the post office", () => {
    const visited = tutorial.map((quest) => quest.targetId);
    expect(visited).toEqual(["npc-biscuit", "npc-maple", "npc-lumi", "npc-moss", "npc-pip"]);
    // Each stop hands the letter to the next villager, so the route is continuous.
    expect(tutorial.map((quest) => quest.giverId)).toEqual(["npc-pip", ...visited.slice(0, -1)]);
    const covered = new Set([...tutorial.map((quest) => quest.giverId), ...visited]);
    expect([...covered].sort()).toEqual([...MAIN_VILLAGERS].sort());
  });

  it("never puts onboarding behind a clock or a stalling condition", () => {
    for (const quest of tutorial) {
      expect(quest.timeLimitSeconds).toBeUndefined();
      expect(quest.parcelCondition === undefined || quest.parcelCondition === "normal" || quest.parcelCondition === "fragile").toBe(true);
    }
    // Fragile is the single conditioned step and can only fail on defeat, which
    // cannot happen in the monster-free village.
    const conditioned = tutorial.filter((quest) => quest.parcelCondition === "fragile");
    expect(conditioned).toHaveLength(1);
    expect(conditioned[0].breaksOnDefeat).toBe(true);
  });

  it("rewards exactly enough XP to finish the circuit on level 5", () => {
    const totalXp = tutorial.reduce((sum, quest) => sum + (quest.xpReward ?? 0), 0);
    const totalStamps = tutorial.reduce((sum, quest) => sum + quest.stampReward, 0);
    expect(totalXp).toBe(400);
    expect(totalStamps).toBe(80);

    const after = applyExperience(1, 0, totalXp);
    expect(after.level).toBe(5);
    // Level 6 is the next threshold, so the circuit must not overshoot it either.
    expect(after.level).toBeLessThan(6);
  });

  it("keeps the carried parcel named as a welcome letter in content", () => {
    const letter = itemContent.items.find((item): item is Item => item.id === WELCOME_LETTER);
    expect(letter?.name).toBe("Welcome Letter");
    expect(letter?.category).toBe("delivery");
  });
});
