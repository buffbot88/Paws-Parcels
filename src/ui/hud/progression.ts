import type { NetQuestProgression } from "../../net/GameSocket.ts";

/**
 * The level-up / rank-up "moment" — pure presentation model.
 *
 * The server already decided everything here: `progression` on a delivery
 * carries the level it wrote, the level the courier had, how many levels that
 * crossed, and the rank it promoted to (if any). Nothing in the client
 * re-derives the XP curve or compares ranks, so a courier who logs in at level
 * 4 never gets a bogus "level up" from a stale mirror, and a rank promotion is
 * announced because the server said so, not because two strings differed.
 *
 * Copy lives here rather than in the DOM component so the wording, the
 * multi-level case and the combined case are unit-testable without a browser.
 */
export interface LevelUpMoment {
  /** Poster headline, e.g. "Level Up!" or "Level Up · Promotion!". */
  title: string;
  /** What the courier is now, e.g. "Level 5". */
  headline: string;
  /** Supporting lines, in render order. */
  details: string[];
  /** Which moment this is — drives the banner's accent and sound. */
  tone: "level" | "rank" | "both";
  level: number;
  levelsGained: number;
  rankPromotion: string | null;
}

/** One skill point is granted per level crossed (see `applyExperience`). */
function skillPointLine(levelsGained: number): string {
  const points = `${levelsGained} skill point${levelsGained === 1 ? "" : "s"}`;
  return `+${points}`;
}

/**
 * Build the moment a delivery should celebrate, or `null` when the courier did
 * not gain a level and was not promoted. A plain delivery — the common case —
 * therefore returns null and shows nothing.
 */
export function levelUpMoment(progression: NetQuestProgression | undefined | null): LevelUpMoment | null {
  if (progression === null || progression === undefined) return null;
  const levelsGained = Math.max(0, Math.floor(progression.levelsGained));
  const rankPromotion = progression.rankPromotion ?? null;
  if (levelsGained <= 0 && rankPromotion === null) return null;

  const level = Math.max(1, Math.floor(progression.level));
  const details: string[] = [];
  if (levelsGained > 0) details.push(skillPointLine(levelsGained));
  if (rankPromotion !== null) details.push(`Promoted to ${rankPromotion}`);

  const tone: LevelUpMoment["tone"] =
    levelsGained > 0 && rankPromotion !== null ? "both" : levelsGained > 0 ? "level" : "rank";
  const title =
    tone === "both" ? "Level Up · Promotion!" : tone === "rank" ? "Promotion!" : "Level Up!";

  return {
    title,
    // Multi-level deliveries read as the crossing, not just the destination:
    // the closing delivery of the tutorial can cross two levels at once.
    headline:
      levelsGained > 1
        ? `Level ${progression.previousLevel} → ${level}`
        : `Level ${level}`,
    details,
    tone,
    level,
    levelsGained,
    rankPromotion,
  };
}

/** Single-line summary for logs, aria-live announcements and tests. */
export function describeMoment(moment: LevelUpMoment): string {
  return [moment.title, moment.headline, ...moment.details].join(" · ");
}
