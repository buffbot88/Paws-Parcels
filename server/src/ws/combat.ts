/**
 * Pure server-side combat math (design/combat.md §2-§6). Damage, crit, range
 * and cooldown checks are computed here and only here — the client never
 * contributes to combat outcomes. Deterministic enough to unit-test; crits
 * take an injected RNG so tests can force hit/crit paths.
 */

/** Tile distance between two points (Chebyshev — movement is 4-direction). */
export function tileDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export interface CombatAttacker {
  attack: number;
  critChance: number;
  critMultiplier: number;
}

export interface CombatTarget {
  defense: number;
}

export interface DamageResult {
  damage: number;
  crit: boolean;
}

/**
 * design/combat.md §2: raw = attack - defense, floored at 20% of attack;
 * a crit roll multiplies the damage by the attacker's crit multiplier.
 */
export function computeDamage(
  attacker: CombatAttacker,
  target: CombatTarget,
  random: () => number = Math.random,
): DamageResult {
  const raw = attacker.attack - target.defense;
  const floor = Math.round(attacker.attack * 0.2);
  let damage = Math.max(raw, floor);
  const crit = random() < attacker.critChance / 100;
  if (crit) damage = Math.round(damage * attacker.critMultiplier);
  return { damage: Math.max(1, damage), crit };
}

export type AttackVerdict =
  | { ok: true }
  | {
      ok: false;
      code:
        | "TARGET_DEAD"
        | "OUT_OF_RANGE"
        | "COOLDOWN_ACTIVE"
        | "ATTACKER_DEFEATED";
    };

export interface ValidateAttackInput {
  /** Distance in tiles between attacker and target. */
  range: number;
  /** The ability's max range in tiles (melee 1, ranged 3-5 per class). */
  maxRange: number;
  /** Cooldown in ms for the ability. */
  cooldownMs: number;
  /** Last use time (ms epoch). */
  lastUseAt: number;
  /** Current time (ms epoch). */
  now: number;
  /** Target alive? */
  targetAlive: boolean;
  /** Attacker alive? */
  attackerAlive: boolean;
}

/**
 * Validate an attack intent (design/combat.md §6 validation table). Range,
 * alive-check, and cooldown are all enforced server-side.
 */
export function validateAttack(input: ValidateAttackInput): AttackVerdict {
  if (!input.attackerAlive) return { ok: false, code: "ATTACKER_DEFEATED" };
  if (!input.targetAlive) return { ok: false, code: "TARGET_DEAD" };
  if (input.range > input.maxRange) return { ok: false, code: "OUT_OF_RANGE" };
  if (input.now - input.lastUseAt < input.cooldownMs) {
    return { ok: false, code: "COOLDOWN_ACTIVE" };
  }
  return { ok: true };
}

/**
 * Per-class basic-attack profiles (design/classes.md §1-§3): range in tiles
 * and cooldown in ms. Unknown class keys fall back to a safe melee default.
 */
export interface ClassCombatProfile {
  maxRange: number;
  cooldownMs: number;
}

const CLASS_PROFILES: Readonly<Record<string, ClassCombatProfile>> = {
  "bear-warrior": { maxRange: 1, cooldownMs: 3000 },
  "cat-mage": { maxRange: 4, cooldownMs: 2500 },
  "fox-archer": { maxRange: 5, cooldownMs: 2000 },
};

/** Basic-attack profile for a class key (safe melee default for unknowns). */
export function classCombatProfile(classKey: string): ClassCombatProfile {
  return CLASS_PROFILES[classKey] ?? { maxRange: 1, cooldownMs: 3000 };
}
