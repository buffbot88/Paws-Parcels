import { ZoneKeys } from "../game/GameConstants.ts";
import { MAPS } from "../game/Maps.ts";

/** Shape of a character row as stored by the auth flow (paws.auth.characters). */
export interface BootCharacter {
  id: number;
  name: string;
  class_id: number;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
}

/** Where the client should boot: a zone registered in MAPS + a tile position. */
export interface BootTarget {
  zoneId: string;
  pos: { x: number; y: number };
}

/** The hub zone used whenever the courier has no registered saved zone. */
export const DEFAULT_BOOT_ZONE = ZoneKeys.CloverVillage;

/** Read the bootable characters list (undefined when auth hasn't completed). */
export function readBootCharacters(): BootCharacter[] | undefined {
  const win = window as { pawsCharacters?: BootCharacter[] };
  return win.pawsCharacters;
}

/**
 * The localStorage key holding the courier the player chose to play as
 * (written by the character select desk, Phase 2 client hookup).
 */
export const SELECTED_CHARACTER_KEY = "paws.auth.selectedCharacter";

/** Read the player's chosen courier id (null when never chosen / storage off). */
export function readSelectedCharacterId(): number | null {
  if (typeof window === "undefined") return null; // node test env
  try {
    const raw = window.localStorage.getItem(SELECTED_CHARACTER_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Remember the chosen courier across page loads (best effort). */
export function writeSelectedCharacterId(id: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_CHARACTER_KEY, String(id));
  } catch {
    // Private mode — selection lives only for this session.
  }
}

/**
 * Pick the courier to play: the player's stored choice when it still exists
 * in the list, otherwise the first listed courier. Returns null when the
 * account has no characters yet (the creation desk handles that case).
 */
export function pickCharacter(
  characters: BootCharacter[] | undefined,
  selectedId: number | null,
): BootCharacter | null {
  if (!Array.isArray(characters) || characters.length === 0) return null;
  const chosen = characters.find((c) => c.id === selectedId);
  return chosen ?? characters[0] ?? null;
}

/**
 * Choose the boot target for the selected courier — their saved zone + tile
 * position when that zone is registered client-side, otherwise the default
 * hub at its authoritative spawn. Never returns an unregistered zone, so the
 * scene can always build a walkable world.
 */
export function resolveBootTarget(
  characters: BootCharacter[] | undefined,
): BootTarget {
  const character = pickCharacter(characters, readSelectedCharacterId());
  if (character !== null && MAPS[character.zone_id] !== undefined) {
    return {
      zoneId: character.zone_id,
      pos: { x: character.pos_x, y: character.pos_y },
    };
  }
  const hub = MAPS[DEFAULT_BOOT_ZONE];
  return {
    zoneId: DEFAULT_BOOT_ZONE,
    pos: { x: hub.spawn.x, y: hub.spawn.y },
  };
}
