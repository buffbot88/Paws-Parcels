import Phaser from "phaser";
import { TILE_SIZE } from "./GameConfig.ts";
import { worldDepth } from "./WorldDepth.ts";
import type { MapData } from "./Maps.ts";
import {
  CLOVER_VILLAGE_QUEST_ITEM_FRAMES,
  CloverVillageTextureKeys,
  SET_PIECES,
  type CloverVillageSetPieceDefinition,
} from "./cloverVillagePlacements.ts";

/**
 * Authored 2.5D art pass for the NEW Clover Village layout.
 *
 * Composition (matching the approved reference overview):
 *   1. Courier Square — plaza with flower bed, bench, banners, lanterns
 *   2. Four professions — Café (16), Florist (3), Research Shop (5), Garden
 *   3. Post Office — the two-story Building 17 headquarters
 *   4. Woodland landmarks — Rabbit Burrow, Hollow Oak, two ponds
 *   5. Residential cottages — background worldbuilding
 *   6. Happy Valley road — lamp-lit route through the southern gate
 *
 * Repetition rules: major landmarks once, buildings once, benches 3-5,
 * lanterns 8-15, fences many, vegetation heavily repeated with scale/position
 * variation. Collision stays authoritative in the ASCII map; every set piece
 * here is visual-only.
 *
 * The placement tables (texture keys, set-piece coordinates, fence runs) live
 * in `cloverVillagePlacements.ts` — a Phaser-free module so the node test env
 * can import them for the interactable-art parity check. This file owns only
 * the Phaser glue: asset queueing, ground/road tiling, and depth-sorted
 * rendering.
 */

type AssetGlob = Record<string, string>;

/**
 * Authored 2.5D source art. Land and road textures form the opaque visible
 * surface; buildings, landmarks, and decor remain transparent set-piece
 * overlays depth-sorted against the couriers.
 */
const sourceAssets: Readonly<Record<string, AssetGlob>> = {
  ground: import.meta.glob(
    "../../reference/assets/new/CloverValley/Ground/meadow.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  road: import.meta.glob(
    "../../reference/assets/new/CloverValley/Ground/road.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  plaza: import.meta.glob(
    "../../reference/assets/new/CloverValley/Ground/plaza.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,

  postOffice: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_17/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  shop: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_5/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cafe: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_16/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  florist: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_3/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cottageNorthWest: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_6/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cottageNorthEast: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/buildings/building_7/building_1.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,

  postOfficeSign: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/post-office-sign.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  parcels: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/parcels.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  courierBanner: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/courier-banner.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cafeSign: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/cafe-sign.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  cafeFront: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/cafe-front.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  researchSign: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/research-shop-sign.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  researchTable: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/research-table.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  floristSign: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/florist-sign.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  flowerFront: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/flower-front.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  gardenProp: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/garden-prop.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  hollowOak: import.meta.glob(
    "../../reference/assets/new/CloverValley/Buildings/hollow-oak.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,

  rabbitBurrow: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/rabbit-burrow.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  bench: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/bench.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  bridge: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/bridge.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  lampPost: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/lamp-post.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  mailbox: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/mailbox.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  picnic: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/picnic-setup.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  pondArea: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/pond-area.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  // Authored reference set pieces (scripts/generate-clover-valley-props.mjs).
  cafeTable: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/cafe-table.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  gardenBed: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/garden-bed.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  clothesline: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/clothesline.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  entranceArch: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/entrance-arch.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  lilyPads: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/lily-pads.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  questItems: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/quest-items.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  questItemsAlt: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/quest-items.2.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,

  fenceStraight: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-straight.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fenceLongStraight: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-long-straight.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fenceCorner: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-corner.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fenceAngleLeft: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-angle-left.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fenceAngleRight: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-angle-right.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fencePost: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-post.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fencePostBroken: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-post-broken.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fenceShortStraight: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-short-straight.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  fenceGate: import.meta.glob(
    "../../reference/assets/new/CloverValley/Props/fence/fence-gate.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  questBoard: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/decor_9.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  signpost: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/decor_4.png",
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
  greeneryAlt: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_2.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  greeneryThird: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_3.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  greeneryFourth: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_4.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  greeneryFifth: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/greenery_5.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  stones: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/decor/stones_1.png",
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
};

function firstUrl(group: AssetGlob): string | null {
  return Object.values(group)[0] ?? null;
}

function queueImage(scene: Phaser.Scene, key: string, group: AssetGlob): void {
  const url = firstUrl(group);
  if (url !== null && !scene.textures.exists(key)) scene.load.image(key, url);
}

/**
 * After the loader finishes, cut the named item frames out of the multi-item
 * quest-items sheet. Frames are registered as regular texture frames so the
 * set-piece renderer can treat each item as standalone art (correct origin,
 * sizing, and depth math) without rasterizing new files. Idempotent; called
 * from addCloverVillageSetPieces, which only runs once assets are loaded.
 */
function registerQuestItemFrames(scene: Phaser.Scene): void {
  const key = CloverVillageTextureKeys.questItems;
  if (!scene.textures.exists(key)) return;
  const texture = scene.textures.get(key);
  for (const [name, rect] of Object.entries(CLOVER_VILLAGE_QUEST_ITEM_FRAMES)) {
    if (texture.has(name)) continue;
    texture.add(name, 0, rect.x, rect.y, rect.width, rect.height);
  }
}

/** Queue the authored Clover Village surface and transparent set-piece art. */
export function queueCloverVillageAssets(scene: Phaser.Scene): void {
  for (const [name, group] of Object.entries(sourceAssets)) {
    queueImage(scene, CloverVillageTextureKeys[name as keyof typeof CloverVillageTextureKeys], group);
  }
}

/** Resolve the texture key + optional frame for a set-piece definition. */
function resolveTexture(
  scene: Phaser.Scene,
  piece: CloverVillageSetPieceDefinition,
): { key: string; frame?: string } | null {
  if (piece.frame !== undefined) {
    // A frame placement needs both the sheet texture and its registered frame.
    if (!scene.textures.exists(piece.texture)) return null;
    const texture = scene.textures.get(piece.texture);
    if (!texture.has(piece.frame)) return null;
    return { key: piece.texture, frame: piece.frame };
  }
  if (!scene.textures.exists(piece.texture)) return null;
  return { key: piece.texture };
}

/**
 * Build the authored visible surface for Clover Village. The collision tilemap
 * remains authoritative underneath; this layer replaces its procedural visual
 * language with the supplied land and road art.
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
  // Courier Square is paved (reference look: cobblestone plaza in front of
  // the Post Office); the rest of the path network keeps the warm earth road.
  const isPlaza = (x: number, y: number) =>
    x >= 29 && x <= 44 && y >= 25 && y <= 35 && scene.textures.exists(CloverVillageTextureKeys.plaza);
  for (let y = 0; y < map.height; y++) {
    const row = map.rows[y] ?? "";
    for (let x = 0; x < map.width; x++) {
      if (row[x] !== "P") continue;
      const key = isPlaza(x, y) ? CloverVillageTextureKeys.plaza : CloverVillageTextureKeys.road;
      const tile = scene.add
        .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, key)
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setDepth(-15);
      added.push(tile);
    }
  }
  return added;
}

/** Add the curated buildings, landmarks, and decor for Clover Village. */
export function addCloverVillageSetPieces(scene: Phaser.Scene): Phaser.GameObjects.Image[] {
  registerQuestItemFrames(scene);
  const added: Phaser.GameObjects.Image[] = [];
  for (const piece of SET_PIECES) {
    const resolved = resolveTexture(scene, piece);
    if (resolved === null) continue;
    const { key, frame } = resolved;
    const x = piece.tileX * TILE_SIZE;
    const y = piece.baseTileY * TILE_SIZE;

    // A soft contact shadow sized from the actual art keeps authored overlays
    // grounded against the continuous field without blocky tile artifacts.
    // cutWidth covers both plain textures and manually added sheet frames.
    const source = scene.textures.get(key).get(frame);
    const frameWidth = source.cutWidth;
    const shadowWidth = Math.min(320, Math.max(24, frameWidth * piece.scale * 0.7));
    const shadow = scene.add
      .ellipse(x, y - 4, shadowWidth, Math.max(10, shadowWidth * 0.2), 0x263b2a, 0.2)
      .setDepth(worldDepth(y, -0.04));

    const image = scene.add
      .image(x, y, key, frame)
      .setOrigin(0.5, 1)
      .setScale(piece.scale)
      .setDepth(worldDepth(y, piece.depthOffset ?? 0));
    if (piece.rotation !== undefined && piece.rotation !== 0) {
      image.setRotation(piece.rotation);
    }
    if (piece.flipX === true) image.setFlipX(true);
    // Keep presentation metadata attached to the successfully loaded image;
    // capture review must not infer assets from a positional array index.
    image.setData("cloverVillageAsset", piece.texture);
    if (frame !== undefined) image.setData("cloverVillageFrame", frame);
    image.setData("cloverVillageShadow", shadow);
    added.push(image);
  }
  return added;
}
