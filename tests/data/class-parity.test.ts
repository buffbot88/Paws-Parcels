import { describe, expect, it } from "vitest";
import classesJson from "../../src/data/classes.json";
import { classSpeed, type ClassKey } from "../../src/game/classStats.ts";
import { CLASS_PROFILES } from "../../server/src/ws/combat.ts";

// Client movement and server combat both key off the same class ids; a
// drift between these tables desyncs rendered vs authoritative couriers.
describe("class data parity (client vs server)", () => {
  const classes = classesJson.classes as { key: string; baseStats: { speed: number } }[];

  it("client CLASS_SPEED matches classes.json baseStats.speed for every class", () => {
    for (const cls of classes) {
      expect(classSpeed(cls.key as ClassKey), cls.key).toBe(cls.baseStats.speed);
    }
  });

  it("server CLASS_PROFILES covers exactly the classes.json keys (no fallback masking)", () => {
    // Assert against the RAW table, not classCombatProfile() — its unknown-key
    // fallback would make a deleted profile still "pass" (> 0 checks).
    const classKeys = classes.map((cls) => cls.key).sort();
    expect(Object.keys(CLASS_PROFILES).sort()).toEqual(classKeys);
    for (const cls of classes) {
      const profile = CLASS_PROFILES[cls.key];
      expect(profile, cls.key).toBeDefined();
      expect(profile.maxRange, cls.key).toBeGreaterThan(0);
      expect(profile.cooldownMs, cls.key).toBeGreaterThan(0);
    }
  });
});
