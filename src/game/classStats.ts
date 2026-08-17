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
