/**
 * Prop size bands (visual Pass 3 — landmark scale).
 *
 * Why this exists: every set piece used to carry a bare `scale:` number with no
 * shared convention behind it, and the entity classes disagreed with each other
 * too — the courier rendered at 1.33, NPC art at 0.095, monsters at 1.1. Nothing
 * said how tall a tree, a bench or a building *should* be, so "the props don't
 * all feel like the same world" was unfalsifiable and unfixable.
 *
 * The entity half of that is now `entitySizing.ts`, which keeps this module's
 * math — `scaleForTiles`, `contactWidthFor`, `contactBoxFrom` — and its own
 * table, because a prop is measured by its canvas and a character by its figure.
 * Both kinds of thing answer to one rule; only the vocabulary differs.
 *
 * This module states the convention. Each prop declares an intended rendered
 * height in tiles, measured the same way for every art pack:
 *
 *   renderedTiles(sourceHeightPx, scale) = sourceHeightPx * scale / 48
 *
 * The courier is the yardstick: a class idle frame is 36px at scale 1.33, so
 * one tile is one courier. A bench is about one courier tall, a sign about two,
 * a canopy tree about five, the Post Office about ten.
 *
 * Deliberately free of Phaser, so `tests/data/prop-sizing.test.ts` can audit
 * every placement in both zones against these bands in the node environment.
 */
import { TILE_SIZE } from "./tileGrid.ts";
import { CloverVillageTextureKeys } from "./cloverVillagePlacements.ts";
import { HappyValleyTextureKeys } from "./happyValleyPlacements.ts";
/**
 * The tile grid this module measures against.
 *
 * Aliased to the shared `tileGrid.ts` constant (rather than imported from
 * GameConfig, which pulls Phaser into the node test environment).
 */
export const PROP_TILE_PX = TILE_SIZE;

/**
 * Texture-key names are only authoring shorthand — placements carry the
 * resolved key string (`clover-village-building-post-office`). The tables below
 * stay readable (keyed by name) and are resolved through the zone's own key
 * object, so a renamed texture key can never leave a stale audit row behind.
 */
function byTextureKey<K extends string>(
  table: Readonly<Record<string, PropSizing>>,
  keys: Readonly<Record<K, string>>,
): Readonly<Record<string, PropSizing>> {
  return Object.fromEntries(
    Object.entries(table).map(([name, spec]) => [keys[name as K] ?? name, spec]),
  );
}

/**
 * Named height bands, in tiles, from the courier outward.
 *
 * Bands are the *vocabulary*; the per-key intent below is the contract. They are
 * ranges rather than exact values because an 81px grass tuft and a 700px NPC
 * canvas cannot be authored to the same precision, and the point is that a
 * reader can tell which class of object a piece is meant to be.
 */
export const PROP_BANDS = {
  /**
   * Terrain fills: exactly one tile, drawn by the shared surface renderer
   * rather than placed as set pieces.
   */
  surface: { min: 1, max: 1 },
  /** Ground dressing underfoot: lily pads, low planting. */
  decal: { min: 0.2, max: 0.9 },
  /** Waist-to-chest height: benches, tables, mailboxes, fence posts. */
  propSmall: { min: 0.5, max: 1.4 },
  /** Human-scale furniture: lamps, signposts, boards, low stones. */
  propMedium: { min: 1.3, max: 2.2 },
  /** Above head height: banner poles, shop dressing, boulders, tall shrubs. */
  propTall: { min: 2.1, max: 3.6 },
  /** Landmarks you walk around: bridges, ponds, burrows, the hollow oak. */
  structure: { min: 3.4, max: 5.0 },
  /** Canopy vegetation, which must out-top every shrub. */
  canopy: { min: 4.6, max: 6.4 },
  /** Buildings: cottages, shop, café, florist. */
  building: { min: 3.6, max: 7.2 },
  /** The zone's dominant landmark. Exactly one per zone. */
  landmark: { min: 8.5, max: 11.5 },
} as const;

export type PropBand = keyof typeof PROP_BANDS;

/**
 * How far a placement may sit from its key's intended height.
 *
 * A single piece of art reused at 3.2 and 4.8 tiles is the defect this catches;
 * the authored variation that keeps a forest from repeating (a 5% lean either
 * way) stays comfortably inside it.
 */
export const PROP_SIZE_TOLERANCE = 0.25;

export interface PropSizing {
  /** Repository-relative source path, verified against the file by the tests. */
  readonly path: string;
  /** Source PNG size. Must match the file on disk. */
  readonly w: number;
  readonly h: number;
  /** Band this piece belongs to, for a reader and for the audit's messages. */
  readonly band: PropBand;
  /** Intended rendered height in tiles. */
  readonly tiles: number;
}

/** Rendered height of a source image at a scale, in tiles. */
export function renderedTiles(sourceHeightPx: number, scale: number): number {
  return (sourceHeightPx * scale) / PROP_TILE_PX;
}

/** The scale that renders a source image at `tiles`. */
export function scaleForTiles(sourceHeightPx: number, tiles: number): number {
  return (tiles * PROP_TILE_PX) / sourceHeightPx;
}

/** On-screen width of a source image at a scale, in pixels. */
export function renderedWidthPx(sourceWidthPx: number, scale: number): number {
  return sourceWidthPx * scale;
}

/**
 * How much of a piece's rendered width actually touches the ground.
 *
 * The contact footprint is what a cast shadow should match: a bench touches the
 * ground along most of its width, a tree only at the trunk under a wide canopy,
 * and a building along its whole facade. Getting this from the art's *width*
 * (rather than one hand-picked number per renderer) is what lets Pass 6 derive
 * shadows from the same sizing table that Pass 3 audits.
 */
export const FOOTPRINT_FRACTION: Readonly<Record<PropBand, number>> = {
  surface: 1,
  decal: 0.9,
  propSmall: 0.8,
  propMedium: 0.7,
  propTall: 0.6,
  structure: 0.8,
  // A canopy overhangs its trunk; the shadow belongs to the trunk.
  canopy: 0.35,
  building: 0.85,
  landmark: 0.85,
};

/**
 * Ground-contact width from an already-rendered width and a contact fraction.
 *
 * The one line of arithmetic every contact footprint in the game comes from, so
 * that a prop's table and an entity's table (`entitySizing.ts`) can state
 * different fractions for different kinds of thing while sharing the rule.
 */
export function contactWidthFor(renderedWidth: number, fraction: number): number {
  return renderedWidth * fraction;
}

/** Ground-contact width of a piece, in pixels, from its sizing row and scale. */
export function footprintWidthPx(spec: PropSizing, scale: number): number {
  return contactWidthFor(renderedWidthPx(spec.w, scale), FOOTPRINT_FRACTION[spec.band]);
}

/**
 * How much of a piece's height is the part that touches the ground.
 *
 * The top of a tree is canopy, not contact: only the bottom slice of the art
 * can make an NPC look like they are standing inside a bush. Measuring the
 * contact strip rather than the whole bounding box is what lets a tree legitimately
 * overhang the path — which is the composition the reference illustration has.
 */
const CONTACT_DEPTH_SHARE = 0.18;
/** A piece may lean this far past its base line and still read as grounded. */
const CONTACT_FRONT_TILES = 0.3;

/**
 * A piece's ground-contact box, in tile units, relative to its base point.
 *
 * `halfWidth` is horizontal, `back` reaches up-screen from the base line and
 * `front` reaches down-screen. This is the one footprint concept in the codebase:
 * Pass 4 uses it to keep decoration off the tiles players act on, Pass 6 uses its
 * width to size the cast shadow. See `tests/data/prop-sizing.test.ts`.
 */
export interface FootprintBox {
  readonly halfWidth: number;
  readonly back: number;
  readonly front: number;
}

export /** A piece may lean this far up-screen from its base line and still read as grounded. */
const CONTACT_MIN_BACK_TILES = 0.35;

/**
 * The shared contact box, from a ground-contact width (px) and a rendered
 * height (tiles).
 *
 * Split out from `footprintBoxTiles` so entities get the identical box without
 * having to pretend to be props: a prop measures its contact from its art width
 * and a character from its figure, but the box that decides which tiles are
 * occupied is the same box.
 */
export function contactBoxFrom(
  contactWidthPx: number,
  renderedHeightTiles: number,
): FootprintBox {
  return {
    halfWidth: contactWidthPx / 2 / PROP_TILE_PX,
    back: Math.min(
      renderedHeightTiles,
      Math.max(CONTACT_MIN_BACK_TILES, renderedHeightTiles * CONTACT_DEPTH_SHARE),
    ),
    front: CONTACT_FRONT_TILES,
  };
}

export function footprintBoxTiles(spec: PropSizing, scale: number): FootprintBox {
  return contactBoxFrom(footprintWidthPx(spec, scale), renderedTiles(spec.h, scale));
}

/** A placement positioned the way a renderer positions it: base at (tileX, baseTileY). */
export interface PositionedPiece {
  readonly texture: string;
  readonly tileX: number;
  readonly baseTileY: number;
  readonly scale: number;
  readonly frame?: string;
}

/**
 * Does a piece's ground contact overlap the tile at (x, y)?
 *
 * Tiles are treated as unit squares, so tile (x, y) spans `[x, x+1] × [y, y+1]`,
 * and the piece's base line sits at `baseTileY`.
 */
export function coversTile(
  spec: PropSizing,
  piece: PositionedPiece,
  x: number,
  y: number,
): boolean {
  const box = footprintBoxTiles(spec, piece.scale);
  const overlapsX = piece.tileX < x + 0.5 + box.halfWidth && piece.tileX > x + 0.5 - box.halfWidth;
  const top = piece.baseTileY - box.back;
  const bottom = piece.baseTileY + box.front;
  return overlapsX && top < y + 1 && bottom > y;
}

/**
 * Audit a zone's decoration against the tiles players act on.
 *
 * `kinds` selects which reserved kinds to protect: dedicated art is *meant* to
 * sit on its own interactable, so the set-piece pass protects NPC, spawn and
 * transition tiles, while the scatter pass protects everything.
 */
export function auditReservedClearance(
  pieces: readonly PositionedPiece[],
  sizing: Readonly<Record<string, PropSizing>>,
  reserved: readonly { readonly x: number; readonly y: number; readonly kind: string }[],
  kinds: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const piece of pieces) {
    if (piece.frame !== undefined) continue;
    const spec = sizing[piece.texture];
    if (spec === undefined) continue;
    for (const tile of reserved) {
      if (!kinds.includes(tile.kind)) continue;
      if (!coversTile(spec, piece, tile.x, tile.y)) continue;
      violations.push(
        `${piece.texture}@(${piece.tileX},${piece.baseTileY}) covers ${tile.kind} tile (${tile.x},${tile.y})`,
      );
    }
  }
  return violations;
}

const VILLAGE = "reference/assets/maps/CloverVillage/Map/PNG";
const NEW = "reference/assets/new/CloverValley";
const VALLEY = "reference/assets/maps/HappyValley/Map/PNG";
const VALLEY_NEW = "reference/assets/new/HappyValley";

/**
 * Clover Village prop sizing: texture key → source art, band and intent.
 *
 * Heights are the design intent, chosen so the visual hierarchy reads in the
 * right order — canopy over shrub, buildings over props, the Post Office over
 * everything. `tests/data/prop-sizing.test.ts` proves every placement matches.
 */
const CLOVER_VILLAGE_PROP_SIZING_BY_NAME: Readonly<Record<string, PropSizing>> = {
  // --- Terrain (drawn by terrainAssets.ts, not as set pieces) -------------
  ground: { path: `${VILLAGE}/land/land_1.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  grassPatch: { path: `${VILLAGE}/land/land_2.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  road: { path: `${VILLAGE}/road/road_5.png`, w: 64, h: 64, band: "surface", tiles: 1 },
  plaza: { path: `${NEW}/Ground/plaza.png`, w: 64, h: 64, band: "surface", tiles: 1 },
  // The grass-fringe kit is 256px art drawn as a one-tile crop (see
  // terrainSurface.ts `fringeFrameRect`), so `tiles` is the drawn size, not
  // `h` scaled. The audit skips the surface band for exactly that reason.
  fringeNorthA: { path: `${VILLAGE}/land/land_4.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeNorthB: { path: `${VILLAGE}/land/land_8.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeSouthA: { path: `${VILLAGE}/land/land_3.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeSouthB: { path: `${VILLAGE}/land/land_7.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeWestA: { path: `${VILLAGE}/land/land_5.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeWestB: { path: `${VILLAGE}/land/land_9.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeEastA: { path: `${VILLAGE}/land/land_6.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  fringeEastB: { path: `${VILLAGE}/land/land_10.png`, w: 256, h: 256, band: "surface", tiles: 1 },

  // --- Landmark and buildings ---------------------------------------------
  postOffice: {
    path: `${VILLAGE}/buildings/building_17/building_1.png`,
    w: 843,
    h: 766,
    band: "landmark",
    tiles: 10.4,
  },
  cafe: { path: `${VILLAGE}/buildings/building_16/building_1.png`, w: 492, h: 557, band: "building", tiles: 5.7 },
  shop: { path: `${VILLAGE}/buildings/building_5/building_1.png`, w: 695, h: 598, band: "building", tiles: 5.2 },
  florist: { path: `${VILLAGE}/buildings/building_3/building_1.png`, w: 404, h: 410, band: "building", tiles: 5.1 },
  cottageNorthWest: {
    path: `${VILLAGE}/buildings/building_6/building_1.png`,
    w: 515,
    h: 757,
    band: "building",
    tiles: 4.4,
  },
  cottageNorthEast: {
    path: `${VILLAGE}/buildings/building_7/building_1.png`,
    w: 515,
    h: 675,
    band: "building",
    tiles: 3.9,
  },

  // --- Shop dressing and signage ------------------------------------------
  postOfficeSign: { path: `${NEW}/Buildings/post-office-sign.png`, w: 502, h: 502, band: "propTall", tiles: 2.6 },
  cafeFront: { path: `${NEW}/Buildings/cafe-front.png`, w: 502, h: 502, band: "propTall", tiles: 2.6 },
  cafeSign: { path: `${NEW}/Buildings/cafe-sign.png`, w: 426, h: 426, band: "propTall", tiles: 2.4 },
  floristSign: { path: `${NEW}/Buildings/florist-sign.png`, w: 426, h: 426, band: "propTall", tiles: 2.4 },
  researchSign: {
    path: `${NEW}/Buildings/research-shop-sign.png`,
    w: 426,
    h: 426,
    band: "propTall",
    tiles: 2.4,
  },
  flowerFront: { path: `${NEW}/Buildings/flower-front.png`, w: 476, h: 476, band: "propTall", tiles: 2.8 },
  gardenProp: { path: `${NEW}/Buildings/garden-prop.png`, w: 696, h: 522, band: "propTall", tiles: 2.7 },
  parcels: { path: `${NEW}/Buildings/parcels.png`, w: 376, h: 376, band: "propMedium", tiles: 2.0 },
  courierBanner: {
    path: `${NEW}/Buildings/courier-banner.png`,
    w: 652,
    h: 652,
    band: "propTall",
    tiles: 3.3,
  },
  entranceArch: { path: `${NEW}/Props/entrance-arch.png`, w: 384, h: 448, band: "propTall", tiles: 2.8 },

  // --- Landmarks you walk around ------------------------------------------
  hollowOak: { path: `${NEW}/Buildings/hollow-oak.png`, w: 695, h: 926, band: "structure", tiles: 4.8 },
  rabbitBurrow: { path: `${NEW}/Props/rabbit-burrow.png`, w: 589, h: 722, band: "structure", tiles: 3.8 },
  pondArea: { path: `${NEW}/Props/pond-area.png`, w: 984, h: 656, band: "structure", tiles: 3.4 },
  bridge: { path: `${NEW}/Props/bridge.png`, w: 860, h: 573, band: "structure", tiles: 3.6 },

  // --- Plaza and garden furniture -----------------------------------------
  picnic: { path: `${NEW}/Props/picnic-setup.png`, w: 676, h: 451, band: "propTall", tiles: 2.4 },
  researchTable: { path: `${NEW}/Buildings/research-table.png`, w: 492, h: 369, band: "propMedium", tiles: 1.9 },
  lampPost: { path: `${NEW}/Props/lamp-post.png`, w: 522, h: 348, band: "propMedium", tiles: 1.9 },
  questBoard: { path: `${VILLAGE}/decor/decor_9.png`, w: 229, h: 203, band: "propMedium", tiles: 1.5 },
  signpost: { path: `${VILLAGE}/decor/decor_4.png`, w: 157, h: 189, band: "propMedium", tiles: 1.6 },
  bench: { path: `${NEW}/Props/bench.png`, w: 338, h: 225, band: "propSmall", tiles: 1.1 },
  mailbox: { path: `${NEW}/Props/mailbox.png`, w: 338, h: 225, band: "propSmall", tiles: 1.1 },
  clothesline: { path: `${NEW}/Props/clothesline.png`, w: 288, h: 224, band: "propSmall", tiles: 1.2 },
  gardenBed: { path: `${NEW}/Props/garden-bed.png`, w: 320, h: 192, band: "propSmall", tiles: 1.0 },
  cafeTable: { path: `${NEW}/Props/cafe-table.png`, w: 224, h: 176, band: "propSmall", tiles: 0.9 },
  lilyPads: { path: `${NEW}/Props/lily-pads.png`, w: 192, h: 96, band: "decal", tiles: 0.4 },
  questItems: { path: `${NEW}/Props/quest-items.png`, w: 128, h: 85, band: "decal", tiles: 0.6 },
  questItemsAlt: { path: `${NEW}/Props/quest-items.2.png`, w: 522, h: 348, band: "propMedium", tiles: 1.9 },

  // --- Fences (one family, one height) ------------------------------------
  fenceStraight: { path: `${NEW}/Props/fence/fence-straight.png`, w: 338, h: 158, band: "propSmall", tiles: 0.8 },
  fenceLongStraight: {
    path: `${NEW}/Props/fence/fence-long-straight.png`,
    w: 512,
    h: 203,
    band: "propSmall",
    tiles: 1.0,
  },
  fenceShortStraight: {
    path: `${NEW}/Props/fence/fence-short-straight.png`,
    w: 212,
    h: 131,
    band: "propSmall",
    tiles: 0.7,
  },
  fenceCorner: { path: `${NEW}/Props/fence/fence-corner.png`, w: 276, h: 168, band: "propSmall", tiles: 0.9 },
  fenceAngleLeft: {
    path: `${NEW}/Props/fence/fence-angle-left.png`,
    w: 166,
    h: 142,
    band: "propSmall",
    tiles: 0.75,
  },
  fenceAngleRight: {
    path: `${NEW}/Props/fence/fence-angle-right.png`,
    w: 218,
    h: 146,
    band: "propSmall",
    tiles: 0.75,
  },
  fencePost: { path: `${NEW}/Props/fence/fence-post.png`, w: 77, h: 134, band: "propSmall", tiles: 0.7 },
  fencePostBroken: {
    path: `${NEW}/Props/fence/fence-post-broken.png`,
    w: 104,
    h: 140,
    band: "propSmall",
    tiles: 0.7,
  },
  fenceGate: { path: `${NEW}/Props/fence/fence-gate.png`, w: 256, h: 166, band: "propSmall", tiles: 0.9 },

  // --- Vegetation ---------------------------------------------------------
  // The canopy must out-top every shrub: these are the tall palms along the
  // village edge and inside the plaza ring.
  tree: { path: `${VILLAGE}/decor/tree_1.png`, w: 355, h: 620, band: "canopy", tiles: 5.4 },
  treeAlt: { path: `${VILLAGE}/decor/tree_2.png`, w: 317, h: 543, band: "canopy", tiles: 5.1 },
  // Shrub layer. greenery_1 is a tall narrow tuft (81x203) that used to be
  // drawn at 0.85-1.1 — up to 4.7 tiles, taller than the trees and larger than
  // the shop, which is the single most out-of-scale decoration in the village.
  greenery: { path: `${VILLAGE}/decor/greenery_1.png`, w: 81, h: 203, band: "propMedium", tiles: 1.9 },
  greeneryAlt: { path: `${VILLAGE}/decor/greenery_2.png`, w: 177, h: 155, band: "propTall", tiles: 2.3 },
  greeneryThird: { path: `${VILLAGE}/decor/greenery_3.png`, w: 172, h: 159, band: "propTall", tiles: 2.7 },
  greeneryFourth: { path: `${VILLAGE}/decor/greenery_4.png`, w: 111, h: 148, band: "propTall", tiles: 2.9 },
  greeneryFifth: { path: `${VILLAGE}/decor/greenery_5.png`, w: 78, h: 97, band: "propTall", tiles: 2.2 },
  stones: { path: `${VILLAGE}/decor/stones_1.png`, w: 103, h: 86, band: "propMedium", tiles: 1.5 },
  stonesAlt: { path: `${VILLAGE}/decor/stones_2.png`, w: 115, h: 106, band: "propMedium", tiles: 1.7 },
  stonesThird: { path: `${VILLAGE}/decor/stones_3.png`, w: 146, h: 117, band: "propMedium", tiles: 1.9 },
};

/**
 * Happy Valley prop sizing.
 *
 * The valley's own pack is authored much smaller, so its pieces carry valley
 * values. Kept in the same table shape so one audit covers both zones — see
 * `tests/data/prop-sizing.test.ts` for the cross-zone finding that the valley's
 * "tree" is roughly a third of the village's, which no single zone's audit can
 * catch and which is left as an open design question rather than silently
 * rescaled.
 */
const HAPPY_VALLEY_PROP_SIZING_BY_NAME: Readonly<Record<string, PropSizing>> = {
  ground: { path: `${VALLEY_NEW}/Ground/valley-meadow.png`, w: 256, h: 256, band: "surface", tiles: 1 },
  path: { path: `${VALLEY_NEW}/Ground/valley-path.png`, w: 64, h: 64, band: "surface", tiles: 1 },
  blueBanner: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Blue Banner.png`,
    w: 160,
    h: 240,
    band: "propMedium",
    tiles: 1.5,
  },
  treeSmall: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Tree Small.png`,
    w: 240,
    h: 280,
    band: "propMedium",
    tiles: 1.8,
  },
  treeMedium: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Tree Medium.png`,
    w: 360,
    h: 400,
    band: "propTall",
    tiles: 2.3,
  },
  bushSmall: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Bushes Small.png`,
    w: 140,
    h: 120,
    band: "propSmall",
    tiles: 0.7,
  },
  bushMedium: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Bushes Medium.png`,
    w: 180,
    h: 140,
    band: "propSmall",
    tiles: 0.9,
  },
  bushLarge: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Bushes Large.png`,
    w: 240,
    h: 140,
    band: "propSmall",
    tiles: 0.9,
  },
  rock01: { path: `${VALLEY}/Top-Down Simple Summer_Prop - Rock 01.png`, w: 120, h: 100, band: "decal", tiles: 0.6 },
  rock02: { path: `${VALLEY}/Top-Down Simple Summer_Prop - Rock 02.png`, w: 100, h: 60, band: "decal", tiles: 0.4 },
  rock04: { path: `${VALLEY}/Top-Down Simple Summer_Prop - Rock 04.png`, w: 60, h: 60, band: "decal", tiles: 0.4 },
  treeStumpShort: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Tree Stump Short.png`,
    w: 120,
    h: 100,
    band: "decal",
    tiles: 0.6,
  },
  campfire: {
    path: `${VALLEY}/Top-Down Simple Summer_Prop - Campfire.png`,
    w: 200,
    h: 160,
    band: "propSmall",
    tiles: 0.8,
  },
};

/** Clover Village's sizing table, keyed by resolved texture key. */
export const CLOVER_VILLAGE_PROP_SIZING: Readonly<Record<string, PropSizing>> = byTextureKey(
  CLOVER_VILLAGE_PROP_SIZING_BY_NAME,
  CloverVillageTextureKeys,
);

/** Happy Valley's sizing table, keyed by resolved texture key. */
export const HAPPY_VALLEY_PROP_SIZING: Readonly<Record<string, PropSizing>> = byTextureKey(
  HAPPY_VALLEY_PROP_SIZING_BY_NAME,
  HappyValleyTextureKeys,
);

/** A placement as the size audit sees it: a texture key plus its authored scale. */
export interface SizedPlacement {
  readonly texture: string;
  readonly scale?: number;
  readonly frame?: string;
}

/** One placement that does not match its declared intent. */
export interface PropSizeViolation {
  readonly texture: string;
  readonly scale: number;
  readonly tiles: number;
  readonly intentTiles: number;
  readonly detail: string;
}

/**
 * Audit placements against `sizing`, returning every piece that renders outside
 * its key's intended height by more than `PROP_SIZE_TOLERANCE`.
 *
 * There is deliberately no separate "outside the band" branch: every band is at
 * least twice the tolerance around its intent, so a placement that left a band
 * would already have failed the intent check first. The bands still earn their
 * place — `tests/data/prop-sizing.test.ts` asserts each declared intent sits
 * inside its own band, which is what keeps the vocabulary honest.
 *
 * Pure and Phaser-free, so it runs in the node test env; the caller supplies the
 * zone's placement list.
 */
export function auditPlacements(
  placements: readonly SizedPlacement[],
  sizing: Readonly<Record<string, PropSizing>>,
): PropSizeViolation[] {
  const violations: PropSizeViolation[] = [];
  for (const placement of placements) {
    const scale = placement.scale ?? 1;
    const spec = sizing[placement.texture];
    if (spec === undefined) {
      violations.push({
        texture: placement.texture,
        scale,
        tiles: Number.NaN,
        intentTiles: Number.NaN,
        detail: "no sizing declared for this texture key",
      });
      continue;
    }
    // Terrain fills are drawn at one tile by the surface renderer, so a
    // placement's scale says nothing about the size of a `surface` piece.
    if (spec.band === "surface") continue;
    // Quest-item frames are cut-outs of a shared sheet, so the sheet's height
    // says nothing about the drawn height of one item.
    if (placement.frame !== undefined) continue;
    const tiles = renderedTiles(spec.h, scale);
    const deviation = Math.abs(tiles - spec.tiles) / spec.tiles;
    if (deviation > PROP_SIZE_TOLERANCE) {
      violations.push({
        texture: placement.texture,
        scale,
        tiles,
        intentTiles: spec.tiles,
        detail: `renders at ${tiles.toFixed(2)} tiles, intent ${spec.tiles} (${(deviation * 100).toFixed(0)}% off)`,
      });
    }
  }
  return violations;
}
