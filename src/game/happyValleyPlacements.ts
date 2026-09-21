/**
 * Pure Happy Valley placement data — deliberately free of Phaser and
 * `import.meta.glob` so node (vitest) can import it for the interactable-art
 * parity suite shared with Clover Village. `happyValleyAssets.ts` owns the
 * Phaser glue and re-exports the symbols below for scene consumers.
 *
 * The valley is the legacy 40×26 meadow zone: one entrance sign on the north
 * path, a pond-sign clearing on the west shore, and a blueberry patch in the
 * northeast. Its art comes exclusively from the valley's own pack
 * (`reference/assets/maps/HappyValley/Map/PNG`) — cross-pack props stay out of
 * the valley per the props-catalog policy. Collision remains authoritative in
 * the ASCII map; every set piece here is visual-only.
 */
import type { TerrainMaterials } from "./terrainAssets.ts";

export const HappyValleyTextureKeys = {
  // Authored ground (generated, same pipeline as the Clover Village meadow/road).
  ground: "happy-valley-ground-authored",
  path: "happy-valley-path-authored",
  // Entrance + route framing.
  blueBanner: "happy-valley-blue-banner",
  treeSmall: "happy-valley-tree-small",
  treeMedium: "happy-valley-tree-medium",
  // Meadow dressing.
  bushSmall: "happy-valley-bush-small",
  bushMedium: "happy-valley-bush-medium",
  bushLarge: "happy-valley-bush-large",
  rock01: "happy-valley-rock-01",
  rock02: "happy-valley-rock-02",
  rock04: "happy-valley-rock-04",
  // Pond shore.
  treeStumpShort: "happy-valley-tree-stump-short",
  campfire: "happy-valley-campfire",
} as const;

export interface HappyValleySetPieceDefinition {
  texture: string;
  /** Center X tile (fractional allowed). */
  tileX: number;
  /** Tile row the art's ground/base line sits on. */
  baseTileY: number;
  scale: number;
  /** Mirror the art horizontally. */
  flipX?: boolean;
}

/**
 * Anchors were checked against `src/data/maps/happy-valley.json` so art sits
 * on walkable grass (never the `T` tree line, `~` water, or the central `P`
 * path) and never covers an interactable, spawn, transition, or monster tile.
 */
export const SET_PIECES: HappyValleySetPieceDefinition[] = [
  // --- Entrance (path mouth x20, welcome sign at 22,3) ---------------------
  // A blue banner marks the arrival meadow beside the welcome sign.
  { texture: HappyValleyTextureKeys.blueBanner, tileX: 23.2, baseTileY: 3, scale: 0.3 },

  // --- Mossy Pond shore (pond sign at 4,11; water starts y9) ---------------
  // Short shore art only — taller props would overlap the water row above.
  { texture: HappyValleyTextureKeys.treeStumpShort, tileX: 4.5, baseTileY: 10.9, scale: 0.28 },
  { texture: HappyValleyTextureKeys.rock02, tileX: 6.3, baseTileY: 10.7, scale: 0.25, flipX: true },
  { texture: HappyValleyTextureKeys.rock04, tileX: 7.7, baseTileY: 10.9, scale: 0.3 },
  { texture: HappyValleyTextureKeys.bushSmall, tileX: 2.3, baseTileY: 10.9, scale: 0.28 },

  // --- Blueberry patch (bushes sign at 31,5; flowers x30-31, y5-6) ---------
  { texture: HappyValleyTextureKeys.bushLarge, tileX: 31.6, baseTileY: 5.9, scale: 0.32 },
  { texture: HappyValleyTextureKeys.bushSmall, tileX: 33.5, baseTileY: 6.6, scale: 0.28, flipX: true },
  { texture: HappyValleyTextureKeys.bushMedium, tileX: 29.9, baseTileY: 6.8, scale: 0.3 },

  // --- Central meadow dressing (route between entrance and pond) -----------
  { texture: HappyValleyTextureKeys.campfire, tileX: 21.4, baseTileY: 13.5, scale: 0.25 },
  { texture: HappyValleyTextureKeys.treeSmall, tileX: 25.5, baseTileY: 9.5, scale: 0.3 },
  { texture: HappyValleyTextureKeys.treeSmall, tileX: 25.5, baseTileY: 17.5, scale: 0.3 },
  { texture: HappyValleyTextureKeys.treeMedium, tileX: 12.5, baseTileY: 16.5, scale: 0.28, flipX: true },
  { texture: HappyValleyTextureKeys.rock01, tileX: 17.5, baseTileY: 7.5, scale: 0.28 },
];

export function getHappyValleySetPieceDefinitions(): readonly HappyValleySetPieceDefinition[] {
  return SET_PIECES;
}

/**
 * Terrain materials for Happy Valley, consumed by the shared
 * `addTerrainSurface` renderer (visual Pass 2).
 *
 * The valley predates the village's ground kit, so it supplies only a base
 * meadow and a path fill; declaring no `fringes`, `patch`, `plaza` or `foliage`
 * is deliberate — it has no art for them, and the shared renderer draws what a
 * zone authors and nothing more. `coveredBlockingCodes` stays empty for the
 * same reason: no authored piece replaces its water or tree tiles, so those
 * keep painting their procedural square and stay visibly solid.
 */
export const HAPPY_VALLEY_TERRAIN: TerrainMaterials = {
  base: HappyValleyTextureKeys.ground,
  path: HappyValleyTextureKeys.path,
  coveredBlockingCodes: [],
};
