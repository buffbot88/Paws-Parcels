/**
 * Phaser-free class stat tables (importable from node tests). The client
 * movement speed must match the server's seeded character_classes.base_stats.speed
 * (design/classes.md) or the server's move-interval cap desyncs the courier.
 */

export type ClassKey = "bear-warrior" | "cat-mage" | "fox-archer";

/** Per-class movement speed in px/s (must match classes.json baseStats.speed). */
export const CLASS_SPEED: Readonly<Record<ClassKey, number>> = {
  "bear-warrior": 150,
  "cat-mage": 170,
  "fox-archer": 190,
};

/**
 * Basic-attack cooldown in ms per class — mirrors the server's authoritative
 * CLASS_PROFILES (server/src/ws/combat.ts) so the skill-bar cooldown visual
 * matches how fast the server will accept the next attack. Pinned by the
 * class-parity test; the server remains the enforcement point.
 */
export const CLASS_COOLDOWN_MS: Readonly<Record<ClassKey, number>> = {
  "bear-warrior": 3000,
  "cat-mage": 2500,
  "fox-archer": 2000,
};

/** The stable seeded class order used by the server's class migration. */
export function classKeyFromId(classId: number): ClassKey {
  if (classId === 2) return "cat-mage";
  if (classId === 3) return "fox-archer";
  return "bear-warrior";
}

/** Movement speed in px/s for a class key. */
export function classSpeed(classKey: ClassKey): number {
  return CLASS_SPEED[classKey];
}

/** Movement speed in px/s for a class id (server-seeded order). */
export function classSpeedFromId(classId: number): number {
  return CLASS_SPEED[classKeyFromId(classId)];
}

/** Basic-attack cooldown in ms for a class key (UI feedback mirror). */
export function classCooldownMs(classKey: ClassKey): number {
  return CLASS_COOLDOWN_MS[classKey];
}
