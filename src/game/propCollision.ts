/**
 * Which tiles solid props block.
 *
 * Collision used to come only from the tile map, so a painted prop blocked only
 * if it happened to sit on a wall or tree tile: some trees, lamps and fences
 * stopped the courier and their twins let them walk straight through. A solid
 * prop now blocks the tiles under its ground contact (propSizing's footprint
 * width, one strip deep at its base line), so a canopy still overhangs the
 * path. Shared by the client's collision layer, the server's movement check and
 * the map validator, so the three never disagree. Pure: no Phaser.
 */
import { CloverVillageTextureKeys as CV, getCloverVillageSetPieceDefinitions } from "./cloverVillagePlacements.ts";
import { HappyValleyTextureKeys as HV, getHappyValleySetPieceDefinitions } from "./happyValleyPlacements.ts";
import {
  CLOVER_VILLAGE_PROP_SIZING,
  HAPPY_VALLEY_PROP_SIZING,
  footprintBoxTiles,
  type PositionedPiece,
  type PropSizing,
} from "./propSizing.ts";

/** Props you walk around. Greenery, lily pads, signs on facades, the arch and the bridge stay passable. */
const SOLID: ReadonlySet<string> = new Set([
  CV.tree, CV.treeAlt, CV.stones, CV.stonesAlt, CV.stonesThird, CV.hollowOak, CV.rabbitBurrow,
  CV.lampPost, CV.bench, CV.cafeTable, CV.gardenBed, CV.gardenProp, CV.flowerFront, CV.mailbox,
  CV.picnic, CV.pondArea, CV.researchTable, CV.questBoard, CV.signpost, CV.courierBanner,
  CV.cafeFront, CV.questItemsAlt,
  CV.fenceStraight, CV.fenceLongStraight, CV.fenceCorner, CV.fenceAngleLeft, CV.fenceAngleRight,
  CV.fencePost, CV.fencePostBroken, CV.fenceShortStraight,
  HV.treeSmall, HV.treeMedium, HV.rock01, HV.rock02, HV.rock04, HV.treeStumpShort, HV.campfire,
  HV.bushLarge, HV.blueBanner,
]);

/** Thin posts still block the tile they stand in. */
const MIN_HALF_WIDTH_TILES = 0.3;
/** How far up-screen from its base line a prop's contact strip reaches. */
const CONTACT_DEPTH_TILES = 0.5;

const ZONES: Readonly<Record<string, { pieces: () => readonly PositionedPiece[]; sizing: Readonly<Record<string, PropSizing>> }>> = {
  "zone-clover-village": { pieces: getCloverVillageSetPieceDefinitions, sizing: CLOVER_VILLAGE_PROP_SIZING },
  "zone-happy-valley": { pieces: getHappyValleySetPieceDefinitions, sizing: HAPPY_VALLEY_PROP_SIZING },
};

const cache = new Map<string, ReadonlySet<string>>();

/** The `"x,y"` tiles solid props block in a zone (empty for an unknown zone). */
export function propBlockedTiles(zoneId: string): ReadonlySet<string> {
  const cached = cache.get(zoneId);
  if (cached !== undefined) return cached;
  const blocked = new Set<string>();
  const zone = ZONES[zoneId];
  for (const piece of zone?.pieces() ?? []) {
    const spec = zone?.sizing[piece.texture];
    if (spec === undefined || piece.frame !== undefined || !SOLID.has(piece.texture)) continue;
    const half = Math.max(MIN_HALF_WIDTH_TILES, footprintBoxTiles(spec, piece.scale).halfWidth);
    const left = piece.tileX - half;
    const right = piece.tileX + half;
    const top = piece.baseTileY - CONTACT_DEPTH_TILES;
    for (let x = Math.floor(left); x < right; x++) {
      for (let y = Math.floor(top); y < piece.baseTileY; y++) blocked.add(`${x},${y}`);
    }
  }
  cache.set(zoneId, blocked);
  return blocked;
}
