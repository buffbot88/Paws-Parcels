/** Shared XP→level math (was duplicated in Character.ts and Quest.ts). */

/** Level N requires N*100 cumulative XP; each level grants one skill point. */
export function applyExperience(
  level: number,
  skillPoints: number,
  totalXp: number,
): { level: number; skillPoints: number } {
  let nextLevel = Math.max(1, level);
  let nextPoints = Math.max(0, skillPoints);
  let threshold = nextLevel * 100;
  while (totalXp >= threshold) {
    nextLevel += 1;
    nextPoints += 1;
    threshold = nextLevel * 100;
  }
  return { level: nextLevel, skillPoints: nextPoints };
}
