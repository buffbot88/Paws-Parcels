import { describe, expect, it } from "vitest";
import {
  classCombatProfile,
  computeDamage,
  tileDistance,
  validateAttack,
} from "../../server/src/ws/combat.ts";

describe("combat — damage formula (design/combat.md §2)", () => {
  it("deals attack minus defense for a normal hit", () => {
    const result = computeDamage(
      { attack: 10, critChance: 0, critMultiplier: 1.5 },
      { defense: 6 },
      () => 0.99, // no crit
    );
    expect(result).toEqual({ damage: 4, crit: false });
  });

  it("floors damage at 20% of attack when defense would null it", () => {
    const result = computeDamage(
      { attack: 10, critChance: 0, critMultiplier: 1.5 },
      { defense: 40 },
      () => 0.99,
    );
    expect(result.damage).toBe(2); // 10 * 0.2
  });

  it("never deals less than 1 damage", () => {
    const result = computeDamage(
      { attack: 1, critChance: 0, critMultiplier: 1.5 },
      { defense: 100 },
      () => 0.99,
    );
    expect(result.damage).toBe(1);
  });

  it("multiplies damage by the crit multiplier on a crit", () => {
    const result = computeDamage(
      { attack: 20, critChance: 100, critMultiplier: 2.0 },
      { defense: 5 },
      () => 0.0, // always crit
    );
    expect(result.crit).toBe(true);
    expect(result.damage).toBe(30); // (20-5) * 2
  });

  it("does not crit when the roll exceeds crit chance", () => {
    const result = computeDamage(
      { attack: 10, critChance: 50, critMultiplier: 2.0 },
      { defense: 0 },
      () => 0.9,
    );
    expect(result.crit).toBe(false);
  });
});

describe("combat — attack validation (design/combat.md §6)", () => {
  const base = {
    maxRange: 4,
    cooldownMs: 2500,
    lastUseAt: 0,
    now: 100_000,
    targetAlive: true,
    attackerAlive: true,
  };

  it("accepts an in-range, off-cooldown attack", () => {
    expect(validateAttack({ ...base, range: 4 })).toEqual({ ok: true });
  });

  it("rejects an out-of-range attack", () => {
    const v = validateAttack({ ...base, range: 5 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("OUT_OF_RANGE");
  });

  it("rejects a dead target", () => {
    const v = validateAttack({ ...base, range: 1, targetAlive: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("TARGET_DEAD");
  });

  it("rejects an attack while the cooldown is active", () => {
    const v = validateAttack({
      ...base,
      range: 1,
      lastUseAt: 99_900,
      now: 100_000,
      cooldownMs: 2500,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("COOLDOWN_ACTIVE");
  });

  it("rejects an attack from a defeated attacker", () => {
    const v = validateAttack({ ...base, range: 1, attackerAlive: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("ATTACKER_DEFEATED");
  });
});

describe("combat — class profiles (design/classes.md)", () => {
  it("warrior is melee (1 tile) with a 3s cooldown", () => {
    expect(classCombatProfile("bear-warrior")).toEqual({ maxRange: 1, cooldownMs: 3000 });
  });

  it("mage has a 4-tile range and 2.5s cooldown", () => {
    expect(classCombatProfile("cat-mage")).toEqual({ maxRange: 4, cooldownMs: 2500 });
  });

  it("archer has the longest range (5 tiles) and fastest cooldown", () => {
    expect(classCombatProfile("fox-archer")).toEqual({ maxRange: 5, cooldownMs: 2000 });
  });

  it("falls back to a safe melee profile for unknown classes", () => {
    expect(classCombatProfile("unknown-class")).toEqual({ maxRange: 1, cooldownMs: 3000 });
  });
});

describe("combat — tile distance", () => {
  it("uses Chebyshev distance (4-direction movement)", () => {
    expect(tileDistance({ x: 1, y: 1 }, { x: 3, y: 1 })).toBe(2);
    expect(tileDistance({ x: 1, y: 1 }, { x: 3, y: 4 })).toBe(3);
    expect(tileDistance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});
