import Phaser from "phaser";
import { TILE_SIZE } from "./GameConfig.ts";
import { worldDepth } from "./WorldDepth.ts";
import type { MapData } from "./Maps.ts";

/** Texture keys for the curated Clover Village set-piece art pass. */
export const CloverVillageTextureKeys = {
  ground: "clover-village-ground-authored",
  road: "clover-village-road-authored",
  greeneryAlt: "clover-village-greenery-alt",
  greeneryThird: "clover-village-greenery-third",
  stonesAlt: "clover-village-stones-alt",
  stonesThird: "clover-village-stones-third",
  postOffice: "clover-village-building-post-office",
  shop: "clover-village-building-shop",
  cafe: "clover-village-building-cafe",
  florist: "clover-village-building-florist",
  cottageNorthWest: "clover-village-building-cottage-north-west",
  cottageNorthEast: "clover-village-building-cottage-north-east",
  tree: "clover-village-tree",
  treeAlt: "clover-village-tree-alt",
  greenery: "clover-village-greenery",
  stones: "clover-village-stones",
} as const;

type AssetGlob = Record<string, string>;

/**
 * Authored 2.5D source art. Land and road textures form the opaque visible
 * surface; buildings and decor remain transparent set-piece overlays.
 */
const sourceAssets: Readonly<Record<string, AssetGlob>> = {
  ground: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/land/land_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  road: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/road/road_5.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  greeneryAlt: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_2.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  greeneryThird: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_3.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  stonesAlt: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/stones_2.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  stonesThird: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/stones_3.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  postOffice: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_1/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  shop: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_4/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cafe: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_10/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  florist: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_12/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cottageNorthWest: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_5/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cottageNorthEast: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_14/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  tree: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/tree_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  treeAlt: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/tree_2.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  greenery: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  stones: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/stones_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
};

function firstUrl(group: AssetGlob): string | null {
  return Object.values(group)[0] ?? null;
}

function queueImage(scene: Phaser.Scene, key: string, group: AssetGlob): void {
  const url = firstUrl(group);
  if (url !== null && !scene.textures.exists(key)) scene.load.image(key, url);
}

/** Queue the authored Clover Village surface and transparent set-piece art. */
export function queueCloverVillageAssets(scene: Phaser.Scene): void {
  for (const [name, group] of Object.entries(sourceAssets)) {
    queueImage(scene, CloverVillageTextureKeys[name as keyof typeof CloverVillageTextureKeys], group);
  }
}

export interface CloverVillageSetPieceDefinition {
  texture: string;
  /** Center X tile. */
  tileX: number;
  /** Tile row immediately above the art's ground/base line. */
  baseTileY: number;
  scale: number;
  depthOffset?: number;
}

/**
 * Anchors follow the authored set-piece placement around the village paths.
 * The ASCII map remains authoritative for collision; stale placeholder
 * building footprints have been converted to walkable terrain in the map data.
 */
const SET_PIECES: readonly CloverVillageSetPieceDefinition[] = [
  {
    texture: CloverVillageTextureKeys.postOffice,
    tileX: 29,
    baseTileY: 31,
    scale: 0.5,
  },
  {
    texture: CloverVillageTextureKeys.shop,
    tileX: 45,
    baseTileY: 31,
    scale: 0.4,
  },
  {
    texture: CloverVillageTextureKeys.cafe,
    tileX: 20,
    baseTileY: 35,
    scale: 0.28,
  },
  {
    texture: CloverVillageTextureKeys.florist,
    tileX: 56,
    baseTileY: 35,
    scale: 0.28,
  },
  {
    texture: CloverVillageTextureKeys.cottageNorthWest,
    tileX: 20,
    baseTileY: 47,
    scale: 0.22,
  },
  {
    texture: CloverVillageTextureKeys.cottageNorthEast,
    tileX: 56,
    baseTileY: 47,
    scale: 0.18,
  },
  { texture: CloverVillageTextureKeys.tree, tileX: 8, baseTileY: 16, scale: 0.27 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 66, baseTileY: 21, scale: 0.29 },
  { texture: CloverVillageTextureKeys.tree, tileX: 12, baseTileY: 64, scale: 0.25 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 64, baseTileY: 64, scale: 0.25 },
  // A storybook frame around the central route: these clusters deliberately
  // sit beside, rather than on top of, interaction tiles and building doors.
  { texture: CloverVillageTextureKeys.greenery, tileX: 19, baseTileY: 27, scale: 0.42 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 24, baseTileY: 33, scale: 0.34 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 51, baseTileY: 33, scale: 0.36 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 61, baseTileY: 35, scale: 0.42 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 24, baseTileY: 45, scale: 0.32 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 51, baseTileY: 45, scale: 0.32 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 16, baseTileY: 52, scale: 0.36 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 60, baseTileY: 52, scale: 0.36 },
  { texture: CloverVillageTextureKeys.stones, tileX: 34, baseTileY: 22, scale: 0.55, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesAlt, tileX: 22, baseTileY: 40, scale: 0.34, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesThird, tileX: 47, baseTileY: 39, scale: 0.32, depthOffset: 0.01 },
];

/** Return the curated set-piece definitions for visual review metadata. */
export function getCloverVillageSetPieceDefinitions(): readonly CloverVillageSetPieceDefinition[] {
  return SET_PIECES;
}

/**
 * Build the authored visible surface for Clover Village. The collision tilemap
 * remains authoritative underneath; this layer replaces its procedural visual
 * language with the supplied tropical-medieval land and road art.
 */
export function addCloverVillageGround(
  scene: Phaser.Scene,
  map: MapData,
): Phaser.GameObjects.GameObject[] {
  if (!scene.textures.exists(CloverVillageTextureKeys.ground)) return [];
  const added: Phaser.GameObjects.GameObject[] = [];
  const worldWidth = map.width * TILE_SIZE;
  const worldHeight = map.height * TILE_SIZE;
  const ground = scene.add
    .tileSprite(worldWidth / 2, worldHeight / 2, worldWidth, worldHeight, CloverVillageTextureKeys.ground)
    .setDepth(-20);
  added.push(ground);

  if (!scene.textures.exists(CloverVillageTextureKeys.road)) return added;
  for (let y = 0; y < map.height; y++) {
    const row = map.rows[y] ?? "";
    for (let x = 0; x < map.width; x++) {
      if (row[x] !== "P") continue;
      const road = scene.add
        .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, CloverVillageTextureKeys.road)
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setDepth(-15);
      added.push(road);

    }
  }
  return added;
}

/** Add the curated buildings and decor for Clover Village. */
export function addCloverVillageSetPieces(scene: Phaser.Scene): Phaser.GameObjects.Image[] {
  const added: Phaser.GameObjects.Image[] = [];
  for (const piece of SET_PIECES) {
    if (!scene.textures.exists(piece.texture)) continue;
    const x = piece.tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = piece.baseTileY * TILE_SIZE;

    // A soft contact shadow keeps authored overlays grounded against the
    // continuous field without turning them into blocky tile art.
    const shadowWidth = Math.min(150, Math.max(54, 180 * piece.scale));
    const shadow = scene.add
      .ellipse(x, y - 4, shadowWidth, Math.max(12, shadowWidth * 0.22), 0x263b2a, 0.2)
      .setDepth(worldDepth(y, -0.04));

    const image = scene.add
      .image(x, y, piece.texture)
      .setOrigin(0.5, 1)
      .setScale(piece.scale)
      .setDepth(worldDepth(y, piece.depthOffset ?? 0));
    // Keep presentation metadata attached to the successfully loaded image;
    // capture review must not infer assets from a positional array index.
    image.setData("cloverVillageAsset", piece.texture);
    image.setData("cloverVillageShadow", shadow); 
    added.push(image);
  }
  return added;
}
