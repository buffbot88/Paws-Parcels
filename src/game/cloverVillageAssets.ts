import Phaser from "phaser";
import { TILE_SIZE } from "./GameConfig.ts";
import { DEPTH_OFFSET, foregroundDepth, worldDepth } from "./WorldDepth.ts";
import { CLOVER_VILLAGE_PROP_SIZING, footprintWidthPx } from "./propSizing.ts";
import { shadowRecipe } from "./lighting.ts";
import type { MapData } from "./Maps.ts";
import {
  CLOVER_VILLAGE_GROUND_KIT,
  CLOVER_VILLAGE_QUEST_ITEM_FRAMES,
  CloverVillageTextureKeys,
  SET_PIECES,
  type CloverVillageSetPieceDefinition,
} from "./cloverVillagePlacements.ts";

/**
 * The CloverVillage land kit, resolved as one directory glob.
 *
 * Which catalog file each texture key draws is data
 * (`CLOVER_VILLAGE_GROUND_KIT`), so the node terrain test can verify the
 * compass role of every wired piece against the topology catalog. Only the
 * lookup lives here, because `import.meta.glob` needs a literal path.
 */
const LAND_KIT_DIR = "../../reference/assets/maps/CloverVillage/Map/PNG/land/";
const landKit = import.meta.glob(
  "../../reference/assets/maps/CloverVillage/Map/PNG/land/land_*.png",
  { eager: true, query: "?url", import: "default" },
) as AssetGlob;

/** Resolve one land-kit texture key to its queueable single-entry glob. */
function kitGroup(textureKey: string): AssetGlob {
  const file = CLOVER_VILLAGE_GROUND_KIT[textureKey];
  if (file === undefined) return {};
  const url = landKit[`${LAND_KIT_DIR}${file}`];
  if (url === undefined) {
    console.error(`Clover Village: land kit piece missing for ${textureKey} (${file})`);
    return {};
  }
  return { [file]: url };
}

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
 * The placement tables (texture keys, set-piece coordinates, fence runs) and
 * the terrain material set live in `cloverVillagePlacements.ts` — a Phaser-free
 * module, so the node test env can import them for the interactable-art parity
 * check. This file owns only the Phaser glue: asset queueing and depth-sorted
 * rendering.
 */

type AssetGlob = Record<string, string>;

/**
 * Authored 2.5D source art. Land and road textures form the opaque visible
 * surface; buildings, landmarks, and decor remain transparent set-piece
 * overlays depth-sorted against the couriers.
 */
const sourceAssets: Readonly<Record<string, AssetGlob>> = {
  // --- Ground surface (visual Pass 2) -----------------------------------
  // Base, road fill and grass fringe kit all come from the CloverVillage land
  // and road kits, which the ground/road audits verified. Two deliberate
  // material swaps, both measured against design/CloverVillage.png:
  //   - base: the kit's land_1 averages #478122; the previously wired
  //     generated meadow averages #6ea948, markedly lighter and yellower than
  //     anything in the reference (whose greens cluster at #29462a..#4c6b3b).
  //   - road: the kit's road_5 averages #ad7d5e against the wired road's
  //     #aa7b5d — the same palette, and road_5 is the catalogued confirmed
  //     centre/fill tile.
  // The plaza deliberately KEEPS its existing stone: it averages #a3aaab
  // against the reference's #a0a19a, while the seamless green paving families
  // average #4f6b56..#67765d and would darken the plaza well away from the
  // reference. See design/assets/clover-village-road-catalog.json.
  ground: kitGroup(CloverVillageTextureKeys.ground),
  road: import.meta.glob(
    "../../reference/assets/maps/CloverVillage/Map/PNG/road/road_5.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  plaza: import.meta.glob(
    "../../reference/assets/new/CloverValley/Ground/plaza.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  grassPatch: kitGroup(CloverVillageTextureKeys.grassPatch),
  fringeNorthA: kitGroup(CloverVillageTextureKeys.fringeNorthA),
  fringeNorthB: kitGroup(CloverVillageTextureKeys.fringeNorthB),
  fringeSouthA: kitGroup(CloverVillageTextureKeys.fringeSouthA),
  fringeSouthB: kitGroup(CloverVillageTextureKeys.fringeSouthB),
  fringeWestA: kitGroup(CloverVillageTextureKeys.fringeWestA),
  fringeWestB: kitGroup(CloverVillageTextureKeys.fringeWestB),
  fringeEastA: kitGroup(CloverVillageTextureKeys.fringeEastA),
  fringeEastB: kitGroup(CloverVillageTextureKeys.fringeEastB),

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

    // A soft contact shadow keeps authored overlays grounded against the
    // continuous field without blocky tile artifacts. Size, offset and alpha all
    // come from the shared lighting recipe, derived from the piece's ground
    // footprint (sizing table + scale), so a trunk and a facade each cast a
    // shadow of their own weight instead of sharing one hand-tuned number.
    const spec = CLOVER_VILLAGE_PROP_SIZING[piece.texture];
    const footprint =
      spec === undefined
        ? undefined
        : footprintWidthPx(spec, piece.scale);
    const recipe = shadowRecipe(footprint ?? 40);
    const shadow = scene.add
      .ellipse(
        x + recipe.offsetXPx,
        y + recipe.offsetYPx,
        recipe.widthPx,
        recipe.heightPx,
        recipe.color,
        recipe.alpha,
      )
      .setDepth(worldDepth(y, DEPTH_OFFSET.contactShadow));

    // A foreground piece draws over the courier instead of sorting against
    // them — see `foregroundDepth` for why that cannot go through worldDepth.
    const depth =
      piece.foreground === true
        ? foregroundDepth(y)
        : worldDepth(y, piece.depthOffset ?? DEPTH_OFFSET.piece);
    const image = scene.add
      .image(x, y, key, frame)
      .setOrigin(0.5, 1)
      .setScale(piece.scale)
      .setDepth(depth);
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
