import { describe, expect, it } from "vitest";
import { applyExperience } from "../../server/src/models/leveling.ts";

describe("applyExperience", () => {
  it("stays at level 1 below the first threshold", () => {
    expect(applyExperience(1, 0, 99)).toEqual({ level: 1, skillPoints: 0 });
  });

  it("levels up exactly at the threshold and grants a skill point", () => {
    expect(applyExperience(1, 0, 100)).toEqual({ level: 2, skillPoints: 1 });
  });

  it("handles multi-level jumps (level N needs N*100 cumulative XP)", () => {
    expect(applyExperience(1, 0, 600)).toEqual({ level: 7, skillPoints: 6 });
    expect(applyExperience(1, 0, 599)).toEqual({ level: 6, skillPoints: 5 });
  });

  it("keeps existing skill points and clamps bad input", () => {
    expect(applyExperience(2, 3, 250)).toEqual({ level: 3, skillPoints: 4 });
    expect(applyExperience(0, -2, 0)).toEqual({ level: 1, skillPoints: 0 });
  });
});
