/**
 * Pure shipped-quest predicate shared by the server filter (Quest.ts) and the
 * data-parity tests. Keeping it in one module means a change to the shipping
 * rule can never silently diverge between the runtime filter and the test
 * that pins the shipped set (tmp/codebase-review-verification.md T4).
 */
export function isShippedQuest(quest: {
  chainPosition?: number;
  phase?: string;
}): boolean {
  return (quest.chainPosition ?? 0) > 0 || quest.phase === "4B";
}
