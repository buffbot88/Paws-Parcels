/** One keyboard binding: help-overlay keycaps plus the keys that trigger it. */
export interface KeyBinding {
  readonly id: string;
  readonly label: string;
  /** Keycaps shown in the help overlay. */
  readonly caps: readonly string[];
  /** Phaser key names registered by InputSystem. */
  readonly phaserKeys?: readonly string[];
  /** `KeyboardEvent.key` values matched by the DOM panel that owns the shortcut. */
  readonly domKeys?: readonly string[];
}

/** Every player-facing shortcut; InputSystem, the DOM panels and the help overlay all read this. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { id: "move", label: "Move", caps: ["W", "A", "S", "D", "↑", "←", "↓", "→"], phaserKeys: ["W", "A", "S", "D", "UP", "LEFT", "DOWN", "RIGHT"] },
  { id: "interact", label: "Talk / interact", caps: ["E", "Space"], phaserKeys: ["E", "SPACE"] },
  { id: "attack", label: "Basic attack", caps: ["1"], phaserKeys: ["ONE"] },
  { id: "inventory", label: "Courier satchel", caps: ["I"], phaserKeys: ["I"] },
  { id: "map", label: "Local map", caps: ["M"], domKeys: ["m", "M"] },
  { id: "questLog", label: "Quest log", caps: ["J"], domKeys: ["j", "J"] },
  { id: "help", label: "Keyboard help", caps: ["?"], domKeys: ["?"] },
  { id: "chat", label: "Chat", caps: ["Enter"], domKeys: ["Enter"] },
  { id: "close", label: "Close panel / leave chat", caps: ["Esc"], domKeys: ["Escape"] },
];

/** Admin-only shortcuts, listed in help only for accounts with dev access. */
export const DEV_KEY_BINDINGS: readonly KeyBinding[] = [
  { id: "capture", label: "Visual review capture", caps: ["Ctrl", "Shift", "V"], phaserKeys: ["V"] },
];

/** Touch equivalents shown under the keyboard table. */
export const TOUCH_HINTS: readonly string[] = [
  "Drag anywhere on the world to move",
  "Tap a villager or object to interact",
  "Tap the skill button to attack",
];

/** Open DOM surfaces that should swallow global shortcuts (J, ?, Enter). */
export const BLOCKING_SURFACES =
  ".profile-panel:not([hidden]), .local-map-panel:not([hidden]), .character-desk:not([hidden]), .dialogue-panel:not(.hidden), .hud-modal:not([hidden]), #login-overlay:not([hidden])";

/** Look up a binding by id; throws on a typo so a renamed binding fails loudly. */
export function binding(id: string): KeyBinding {
  const found = [...KEY_BINDINGS, ...DEV_KEY_BINDINGS].find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Unknown key binding: ${id}`);
  return found;
}

/** True when a keydown matches a DOM-owned binding. */
export function matchesKey(event: KeyboardEvent, id: string): boolean {
  return binding(id).domKeys?.includes(event.key ?? "") === true;
}

/** Comma list of every Phaser key InputSystem registers (for `keyboard.addKeys`). */
export function phaserKeyList(devAccess: boolean): string {
  const list = devAccess ? [...KEY_BINDINGS, ...DEV_KEY_BINDINGS] : KEY_BINDINGS;
  return list.flatMap((entry) => entry.phaserKeys ?? []).join(",");
}

/** Rows for the help overlay, generated from the table. */
export function helpRows(devAccess: boolean): { label: string; caps: readonly string[] }[] {
  const list = devAccess ? [...KEY_BINDINGS, ...DEV_KEY_BINDINGS] : KEY_BINDINGS;
  return list.map((entry) => ({ label: entry.label, caps: entry.caps }));
}

/** True for focus targets that consume typed keys (inputs, textareas, selects, contenteditable). */
export function isTextField(target: EventTarget | null): boolean {
  return (
    (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement) ||
    (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement) ||
    (typeof HTMLSelectElement !== "undefined" && target instanceof HTMLSelectElement) ||
    (typeof HTMLElement !== "undefined" && target instanceof HTMLElement && target.isContentEditable)
  );
}
