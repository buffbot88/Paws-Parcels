/**
 * Pure, DOM-free helpers for the courier desk flow (Phase 2 client hookup).
 * Kept in their own module so the boot-step decision and the name rules can
 * be unit-tested without a browser (the desk itself is DOM-over-Canvas).
 */

/** The step the boot flow should land on given the account's characters. */
export type DeskStep =
  | { step: "play" }
  | { step: "select" }
  | { step: "create" };

/**
 * Decide what the boot flow does with an account's character list:
 *   - 0 characters → creation desk (a fresh account can't join any zone)
 *   - 1 character  → straight into the game (no ceremony for a single courier)
 *   - 2+           → the select desk so the player picks who to play
 */
export function deskStepFor(characterCount: number): DeskStep {
  if (characterCount === 0) return { step: "create" };
  if (characterCount === 1) return { step: "play" };
  return { step: "select" };
}

/** Same shape rule the server enforces (server/src/routes/characters.ts). */
export const CHARACTER_NAME_RE = /^[a-zA-Z0-9 _'.-]+$/;
const CHARACTER_NAME_MAX = 50;

/** Validate a candidate name; returns a cozy error message or null when ok. */
export function validateCharacterName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return "Your courier needs a name — at least 2 letters.";
  }
  if (trimmed.length > CHARACTER_NAME_MAX) {
    return `Keep the name under ${CHARACTER_NAME_MAX} characters.`;
  }
  if (!CHARACTER_NAME_RE.test(trimmed)) {
    return "Use letters, numbers, spaces, and ' - . _ only.";
  }
  return null;
}
