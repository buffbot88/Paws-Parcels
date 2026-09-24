/**
 * Local display preferences — graphics quality, damage numbers, reduced motion,
 * sound volume, and HUD collapse state.
 *
 * Like the mute toggle in `sfx.ts`, these are non-authoritative and live in
 * `localStorage`. Only fields the player actually changed are stored, so an
 * untouched `reducedMotion` keeps following the OS setting.
 */

export interface Settings {
  readonly graphicsQuality: "high" | "low";
  readonly damageNumbers: boolean;
  readonly reducedMotion: boolean;
  /** Sound-effect volume multiplier, 0..1. */
  readonly sfxVolume: number;
  readonly chatCollapsed: boolean;
  readonly minimapCollapsed: boolean;
}

/** Persisted, local-only preference key (JSON of the changed fields). */
export const SETTINGS_KEY = "paws.settings";

type Listener = (settings: Settings) => void;

const listeners = new Set<Listener>();
let overrides: Partial<Settings> = {};
let current: Settings | null = null;

function defaults(): Settings {
  let reducedMotion = false;
  try {
    reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    /* no media queries outside a browser */
  }
  return {
    graphicsQuality: "high",
    damageNumbers: true,
    reducedMotion,
    sfxVolume: 1,
    chatCollapsed: true,
    minimapCollapsed: false,
  };
}

/** Keep only well-typed fields, so a corrupt or stale entry can never break a frame. */
function sanitise(value: unknown): Partial<Settings> {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const clean: { -readonly [K in keyof Settings]?: Settings[K] } = {};
  if (raw.graphicsQuality === "high" || raw.graphicsQuality === "low") {
    clean.graphicsQuality = raw.graphicsQuality;
  }
  if (typeof raw.damageNumbers === "boolean") clean.damageNumbers = raw.damageNumbers;
  if (typeof raw.reducedMotion === "boolean") clean.reducedMotion = raw.reducedMotion;
  if (typeof raw.sfxVolume === "number" && Number.isFinite(raw.sfxVolume)) {
    clean.sfxVolume = Math.min(1, Math.max(0, raw.sfxVolume));
  }
  if (typeof raw.chatCollapsed === "boolean") clean.chatCollapsed = raw.chatCollapsed;
  if (typeof raw.minimapCollapsed === "boolean") clean.minimapCollapsed = raw.minimapCollapsed;
  return clean;
}

function readOverrides(): Partial<Settings> {
  try {
    const stored = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return stored == null ? {} : sanitise(JSON.parse(stored));
  } catch {
    // Blocked storage or unparsable JSON: fall back to defaults.
    return {};
  }
}

/** The current preferences, defaults filled in. Cheap enough to call every frame. */
export function getSettings(): Settings {
  if (current === null) {
    overrides = readOverrides();
    current = { ...defaults(), ...overrides };
  }
  return current;
}

/** Change some preferences, persist them best-effort, and notify subscribers. */
export function updateSettings(partial: Partial<Settings>): Settings {
  getSettings();
  overrides = { ...overrides, ...sanitise(partial) };
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(overrides));
  } catch {
    /* preference is best-effort */
  }
  current = { ...defaults(), ...overrides };
  for (const listener of listeners) listener(current);
  return current;
}

/** Subscribe to preference changes; returns the unsubscribe function. */
export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
