import type { DialogueSet } from "../types/DialogueTypes.ts";

/**
 * Picks the dialogue set for an NPC at a given friendship level. Returns the
 * first set whose [minFriendship, maxFriendship] range contains the level;
 * falls back to the lowest-gated set when nothing matches (e.g. before any
 * unlockable set exists at that level).
 */
export function selectDialogueSet(
  sets: readonly DialogueSet[],
  npcId: string,
  friendshipLevel: number,
): DialogueSet | null {
  const forNpc = sets.filter((d) => d.npcId === npcId);
  if (forNpc.length === 0) return null;

  const match = forNpc.find(
    (d) => friendshipLevel >= d.minFriendship && friendshipLevel <= (d.maxFriendship ?? 4),
  );
  if (match) return match;

  return forNpc.reduce((lowest, d) =>
    d.minFriendship < lowest.minFriendship ? d : lowest,
  );
}
