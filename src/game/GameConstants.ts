/** Shared scene keys — single source of truth for scene transitions. */
export const SceneKeys = {
  Boot: "boot",
  Preloader: "preloader",
  Overworld: "overworld",
} as const;

/** World zones (Phase 2-3): keys match design/world-map.md zone ids. */
export const ZoneKeys = {
  CloverVillage: "zone-clover-village",
  HappyValley: "zone-happy-valley",
} as const;

/** Shared generated fallback texture keys; class art is loaded by PreloaderScene. */
export const TextureKeys = {
  /** Single generated tileset sheet — tile frame index comes from src/game/Tiles.ts. */
  TilesetMain: "tileset-main",
  PlayerIdleDown: "player-idle-down",
  /** White blob tinted per NPC in the NPC entity (Phase 3). */
  NpcBlob: "npc-blob",
  /** Small marker placed on interactable objects (mailbox, board, signs). */
  ObjectMarker: "object-marker",
} as const;

/**
 * Generated size of the interactable-object marker canvas, in px.
 *
 * Shared rather than written into both places because the scene hangs the
 * interaction badge above the marker: the artwork (PreloaderScene) and the badge
 * placement have to agree on where the plaque's top edge is.
 */
export const OBJECT_MARKER_SIZE_PX = 30;
