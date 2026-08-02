export interface DialogueSet {
  id: string;
  npcId: string;
  /** Lowest friendship level this dialogue set applies to (inclusive). */
  minFriendship: number;
  /** Highest friendship level this set applies to; defaults to 4 when omitted. */
  maxFriendship?: number;
  lines: string[];
}
