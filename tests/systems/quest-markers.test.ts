import { describe, expect, it } from "vitest";
import { heldForHandIn, npcQuestMarker, type HeldItem, type MarkerQuest } from "../../src/ui/hud/questMarkers.ts";

function q(overrides: Partial<MarkerQuest> = {}): MarkerQuest {
  return {
    state: "active",
    type: "errand",
    giverId: "npc-pip",
    targetId: "npc-pip",
    requiredItemId: null,
    requiredQuantity: 1,
    progress: 0,
    defeat: null,
    additionalStops: [],
    visitedStops: [],
    ...overrides,
  };
}

const item = (itemKey: string, quantity: number, locked = false): HeldItem => ({ itemKey, quantity, locked });

describe("npcQuestMarker", () => {
  it("shows '!' over the giver of an available quest when nothing is active", () => {
    expect(npcQuestMarker("npc-pip", [q({ state: "available" })], [])).toBe("available");
    expect(npcQuestMarker("npc-moss", [q({ state: "available" })], [])).toBeNull();
  });

  it("shows no '!' while another quest is active (the server rejects a second accept)", () => {
    const quests = [q({ state: "available", giverId: "npc-pip" }), q({ giverId: "npc-moss", targetId: "npc-moss", defeat: { monsterKey: "m", monsterName: "M", count: 2 } })];
    expect(npcQuestMarker("npc-pip", quests, [])).toBeNull();
  });

  it("shows no '!' for a friendship-gated quest the server still reports as locked", () => {
    expect(npcQuestMarker("npc-moss", [q({ state: "locked", giverId: "npc-moss" })], [])).toBeNull();
  });

  it("marks a delivery ready only while holding the bound parcel with every stop visited", () => {
    const delivery = q({ type: "delivery", targetId: "npc-maple", requiredItemId: "item-letter", additionalStops: ["npc-biscuit"] });
    expect(npcQuestMarker("npc-maple", [delivery], [item("item-letter", 1, true)])).toBeNull();
    expect(npcQuestMarker("npc-biscuit", [delivery], [item("item-letter", 1, true)])).toBe("stop");
    const visited = { ...delivery, visitedStops: ["npc-biscuit"] };
    expect(npcQuestMarker("npc-maple", [visited], [item("item-letter", 1, true)])).toBe("ready");
    expect(npcQuestMarker("npc-biscuit", [visited], [item("item-letter", 1, true)])).toBeNull();
    // An unlocked copy is not the bound parcel.
    expect(npcQuestMarker("npc-maple", [visited], [item("item-letter", 1)])).toBeNull();
  });

  it("marks a defeat quest ready once the tally reaches the count", () => {
    const hunt = q({ targetId: "npc-moss", defeat: { monsterKey: "m", monsterName: "M", count: 4 } });
    expect(npcQuestMarker("npc-moss", [{ ...hunt, progress: 3 }], [])).toBeNull();
    expect(npcQuestMarker("npc-moss", [{ ...hunt, progress: 4 }], [])).toBe("ready");
  });

  it("marks a hand-in ready from one unlocked stack big enough, like the server", () => {
    const gather = q({ type: "gathering", requiredItemId: "item-hide", requiredQuantity: 5 });
    expect(npcQuestMarker("npc-pip", [gather], [item("item-hide", 3), item("item-hide", 3)])).toBeNull();
    expect(npcQuestMarker("npc-pip", [gather], [item("item-hide", 5, true)])).toBeNull();
    expect(npcQuestMarker("npc-pip", [gather], [item("item-hide", 6)])).toBe("ready");
  });

  it("marks a search quest ready once the found item is held", () => {
    const search = q({ requiredItemId: "item-pebble", progress: 0 });
    expect(npcQuestMarker("npc-pip", [search], [])).toBeNull();
    expect(npcQuestMarker("npc-pip", [{ ...search, progress: 1 }], [item("item-pebble", 1)])).toBe("ready");
  });

  it("marks a talk or reward errand ready at its target straight away", () => {
    expect(npcQuestMarker("npc-biscuit", [q({ targetId: "npc-biscuit" })], [])).toBe("ready");
    expect(npcQuestMarker("npc-pip", [q({ targetId: "npc-biscuit" })], [])).toBeNull();
  });

  it("shows nothing when there are no quests", () => {
    expect(npcQuestMarker("npc-pip", [], [])).toBeNull();
    expect(npcQuestMarker("npc-pip", [q({ state: "completed" })], [])).toBeNull();
  });
});

describe("heldForHandIn", () => {
  it("counts the largest unlocked stack only", () => {
    expect(heldForHandIn("item-hide", [item("item-hide", 2), item("item-hide", 4), item("item-hide", 9, true), item("item-x", 7)])).toBe(4);
    expect(heldForHandIn("item-hide", [])).toBe(0);
  });
});
