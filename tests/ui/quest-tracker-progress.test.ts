import { describe, expect, it } from "vitest";
import { questProgressLabel } from "../../src/ui/QuestTracker.ts";

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
});
