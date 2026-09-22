import { describe, expect, it } from "vitest";
import classesJson from "../../src/data/classes.json";
import {
  CLASS_RESOURCE,
  classCooldownMs,
  classResourceFromId,
  classSpeed,
  type ClassKey,
} from "../../src/game/classStats.ts";
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

  it("client CLASS_COOLDOWN_MS matches the server's CLASS_PROFILES.cooldownMs", () => {
    for (const cls of classes) {
      expect(classCooldownMs(cls.key as ClassKey), cls.key).toBe(
        CLASS_PROFILES[cls.key].cooldownMs,
      );
    }
  });

  it("client CLASS_RESOURCE matches classes.json for every class", () => {
    // The HUD's second bar shows this resource, so a drifted table would label
    // a courier with the wrong bar and the wrong ceiling.
    const withResources = classesJson.classes as {
      key: string;
      primaryResource: string;
      resourceMax: number;
      resourceRegenPerSec: number;
    }[];
    for (const cls of withResources) {
      const mirrored = CLASS_RESOURCE[cls.key as ClassKey];
      expect(mirrored, cls.key).toBeDefined();
      expect(mirrored.kind, cls.key).toBe(cls.primaryResource);
      expect(mirrored.max, cls.key).toBe(cls.resourceMax);
      expect(mirrored.regenPerSec, cls.key).toBe(cls.resourceRegenPerSec);
      expect(mirrored.label.length, cls.key).toBeGreaterThan(0);
    }
  });

  it("maps every seeded class id onto its own resource", () => {
    // Ids are the server's seeded order (bear 1, cat 2, fox 3).
    expect(classResourceFromId(1).label).toBe("Stamina");
    expect(classResourceFromId(2).label).toBe("Mana");
    expect(classResourceFromId(3).label).toBe("Focus");
    expect(classResourceFromId(2).max).toBe(120);
  });
});
