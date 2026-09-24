import { describe, expect, it, vi } from "vitest";
import { questProgressLabel, readTrackerCollapsed, TRACKER_COLLAPSED_KEY, writeTrackerCollapsed } from "../../src/ui/QuestTracker.ts";

const base = { type: "gathering", progress: 1, requiredQuantity: 3, defeat: null, additionalStops: [], visitedStops: [] };

describe("questProgressLabel", () => {
  it("keeps the plain objective and delivery tallies", () => {
    expect(questProgressLabel(base)).toBe("Objective 1/3");
    expect(questProgressLabel({ ...base, type: "delivery", progress: 0, requiredQuantity: 1 })).toBe("Delivery 0/1");
  });

  it("names the monster for a kill-count objective", () => {
    expect(questProgressLabel({
      ...base,
      type: "errand",
      progress: 2,
      requiredQuantity: 4,
      defeat: { monsterKey: "monster-wild-boar", monsterName: "Wild Boar", count: 4 },
    })).toBe("Wild Boar 2/4");
  });

  it("counts visited stops on a multi-stop delivery", () => {
    expect(questProgressLabel({
      ...base,
      type: "delivery",
      progress: 0,
      requiredQuantity: 1,
      additionalStops: ["npc-biscuit", "npc-lumi"],
      visitedStops: ["npc-lumi"],
    })).toBe("Delivery 0/1 · Stops 1/2");
  });

  it("counts a loot hand-in from the largest unlocked held stack, not server progress", () => {
    const handIn = { ...base, progress: 0, requiredQuantity: 5, requiredItemId: "item-boar-hide", searchObjectId: null };
    const inventory = [
      { itemKey: "item-boar-hide", quantity: 2, locked: false },
      { itemKey: "item-boar-hide", quantity: 3, locked: false },
      { itemKey: "item-boar-hide", quantity: 4, locked: true },
    ];
    expect(questProgressLabel(handIn)).toBe("Held 0/5");
    expect(questProgressLabel(handIn, inventory)).toBe("Held 3/5");
    expect(questProgressLabel(handIn, [{ itemKey: "item-boar-hide", quantity: 9, locked: false }])).toBe("Held 5/5");
    // A search quest keeps its server objective tally.
    expect(questProgressLabel({ ...handIn, searchObjectId: "object-pond-edge" }, inventory)).toBe("Objective 0/5");
  });
});

describe("tracker collapsed preference", () => {
  it("round-trips through localStorage and tolerates blocked storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(readTrackerCollapsed()).toBe(false);
    writeTrackerCollapsed(true);
    expect(store.get(TRACKER_COLLAPSED_KEY)).toBe("1");
    expect(readTrackerCollapsed()).toBe(true);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readTrackerCollapsed()).toBe(false);
    expect(() => writeTrackerCollapsed(false)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
