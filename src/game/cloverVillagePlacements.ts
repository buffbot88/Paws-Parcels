/**
 * Pure Clover Village placement data — deliberately free of Phaser and
 * `import.meta.glob` so it can be imported from node (vitest runs under the
 * `node` environment, which has no `window`). `cloverVillageAssets.ts` owns the
 * Phaser glue (asset queueing, ground/road tiling, depth-sorted set-piece
 * rendering) and re-exports the symbols below for existing consumers.
 *
 * `scripts/generate-clover-village.mjs` is the collision authority (footprints,
 * roads, interactable tiles); this module is the *visual* authority (where art
 * sits). The parity test in tests/data/map-validation.test.ts asserts every
 * interactable tile has dedicated art here, catching silent gaps like a missing
 * mailbox.
 */

export const CloverVillageTextureKeys = {
  plaza: "clover-village-plaza-authored",
  // Authored surface (land + road), drawn under everything.
  ground: "clover-village-ground-authored",
  road: "clover-village-road-authored",
  // Buildings (CloverVillage pack).
  postOffice: "clover-village-building-post-office",
  shop: "clover-village-building-shop",
  cafe: "clover-village-building-cafe",
  florist: "clover-village-building-florist",
  cottageNorthWest: "clover-village-building-cottage-north-west",
  cottageNorthEast: "clover-village-building-cottage-north-east",
  // Building identity + garden (new CloverValley pack).
  postOfficeSign: "clover-valley-post-office-sign",
  parcels: "clover-valley-parcels",
  courierBanner: "clover-valley-courier-banner",
  cafeSign: "clover-valley-cafe-sign",
  cafeFront: "clover-valley-cafe-front",
  researchSign: "clover-valley-research-shop-sign",
  researchTable: "clover-valley-research-table",
  floristSign: "clover-valley-florist-sign",
  flowerFront: "clover-valley-flower-front",
  gardenProp: "clover-valley-garden-prop",
  hollowOak: "clover-valley-hollow-oak",
  // Old CloverVillage decor pack — the only sign-family assets in the catalog.
  // decor_9 is the quest-board (notice board on posts); decor_4 is a signpost.
  questBoard: "clover-village-decor-quest-board",
  signpost: "clover-village-decor-signpost",
  // Scenery props (new CloverValley pack).
  rabbitBurrow: "clover-valley-rabbit-burrow",
  bench: "clover-valley-bench",
  bridge: "clover-valley-bridge",
  lampPost: "clover-valley-lamp-post",
  mailbox: "clover-valley-mailbox",
  picnic: "clover-valley-picnic-setup",
  pondArea: "clover-valley-pond-area",
  // Reference set pieces the pack lacked — authored cutouts (see
  // scripts/generate-clover-valley-props.mjs): café seating, raised garden
  // beds, cottage clotheslines, the grand south gate, and pond lily pads.
  cafeTable: "clover-valley-cafe-table",
  gardenBed: "clover-valley-garden-bed",
  clothesline: "clover-valley-clothesline",
  entranceArch: "clover-valley-entrance-arch",
  lilyPads: "clover-valley-lily-pads",
  // Quest-item sheet (new CloverValley pack) — individual items are addressed
  // via SHEET_FRAMES below; the texture key here is the whole sheet.
  questItems: "clover-valley-quest-items",
  // Adventuring still-life cluster (new CloverValley pack).
  questItemsAlt: "clover-valley-quest-items-alt",
  // Fence kit (new CloverValley pack).
  fenceStraight: "clover-valley-fence-straight",
  fenceLongStraight: "clover-valley-fence-long-straight",
  fenceCorner: "clover-valley-fence-corner",
  fenceAngleLeft: "clover-valley-fence-angle-left",
  fenceAngleRight: "clover-valley-fence-angle-right",
  fencePost: "clover-valley-fence-post",
  fencePostBroken: "clover-valley-fence-post-broken",
  fenceShortStraight: "clover-valley-fence-short-straight",
  fenceGate: "clover-valley-fence-gate",
  // Vegetation + stones (CloverVillage pack, heavily repeated).
  tree: "clover-village-tree",
  treeAlt: "clover-village-tree-alt",
  greenery: "clover-village-greenery",
  greeneryAlt: "clover-village-greenery-alt",
  greeneryThird: "clover-village-greenery-third",
  greeneryFourth: "clover-village-greenery-fourth",
  greeneryFifth: "clover-village-greenery-fifth",
  stones: "clover-village-stones",
  stonesAlt: "clover-village-stones-alt",
  stonesThird: "clover-village-stones-third",
} as const;

export interface CloverVillageSetPieceDefinition {
  texture: string;
  /**
   * Frame name for multi-item sheets (e.g. the quest-items sheet). The frame
   * must be registered in SHEET_FRAMES and is cut from source pixels when the
   * texture loads; scale/depth math then treats the frame as the whole art.
   */
  frame?: string;
  /** Center X tile (fractional allowed). */
  tileX: number;
  /** Tile row the art's ground/base line sits on. */
  baseTileY: number;
  scale: number;
  depthOffset?: number;
  /** Rotation in radians (used by vertical fence runs). */
  rotation?: number;
  /** Mirror the art horizontally. */
  flipX?: boolean;
}

/**
 * Named frames cut from the multi-item quest-items sheet (source pixels).
 * Identified from the sheet art: the golden acorn (Hollow Oak quest), the
 * brass letter opener (Pip), the teal moonlight notebook (Lumi), and the
 * smooth warm pebble (Moss) — matching the quest items in src/data/items.json.
 */
export const CLOVER_VILLAGE_QUEST_ITEM_FRAMES: Readonly<
  Record<"goldenAcorn" | "letterOpener" | "moonNotebook" | "polishedPebble", { x: number; y: number; width: number; height: number }>
> = {
  goldenAcorn: { x: 104, y: 3, width: 21, height: 27 },
  letterOpener: { x: 33, y: 4, width: 25, height: 27 },
  moonNotebook: { x: 3, y: 8, width: 27, height: 21 },
  polishedPebble: { x: 1, y: 37, width: 20, height: 17 },
};

/**
 * Anchors follow the NEW authored layout (scripts/generate-clover-village.mjs
 * is the collision authority): building art bases align with the W footprint
 * bottom rows, landmarks sit beside their interactable markers, and route
 * props line the roads without covering interaction tiles.
 */
export const SET_PIECES: CloverVillageSetPieceDefinition[] = [
  // --- 1. Buildings (art bases sit on the footprint's bottom row) ----------
  // Post Office — Building 17, two-story timber HQ (footprint x33-41, y15-22).
  { texture: CloverVillageTextureKeys.postOffice, tileX: 37.5, baseTileY: 23, scale: 0.6 },
  { texture: CloverVillageTextureKeys.postOfficeSign, tileX: 40.6, baseTileY: 23, scale: 0.2498, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.parcels, tileX: 39.3, baseTileY: 23, scale: 0.2501, depthOffset: 0.02 },
  // Courier Square's central flower bed (reference look): a ring of the
  // florist's flower art around the tilemap's X-flower cluster at (36-38, 27-28).
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 37, baseTileY: 26.4, scale: 0.12 },
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 35.9, baseTileY: 27.5, scale: 0.12 },
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 38.1, baseTileY: 27.5, scale: 0.12 },
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 37, baseTileY: 28.6, scale: 0.12 },
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 36, baseTileY: 28.4, scale: 0.12 },
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 38, baseTileY: 28.4, scale: 0.12 },
  // Café — Building 16 thatched cottage (footprint x15-19, y25-28).
  { texture: CloverVillageTextureKeys.cafe, tileX: 17.5, baseTileY: 29, scale: 0.49 },
  { texture: CloverVillageTextureKeys.cafeSign, tileX: 19.7, baseTileY: 29, scale: 0.2502, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.cafeFront, tileX: 13.3, baseTileY: 30, scale: 0.2498 },
  // Outdoor café seating (reference look): round tables with stools on the
  // lawn in front of the café.
  { texture: CloverVillageTextureKeys.cafeTable, tileX: 12.8, baseTileY: 31.4, scale: 0.2499, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.cafeTable, tileX: 14.8, baseTileY: 31.8, scale: 0.2499, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.cafeTable, tileX: 14.2, baseTileY: 33, scale: 0.2499, depthOffset: 0.02, flipX: true },
  // Research Shop — Building 5 low-roof hall (footprint x51-56, y22-26).
  { texture: CloverVillageTextureKeys.shop, tileX: 54, baseTileY: 27, scale: 0.42 },
  { texture: CloverVillageTextureKeys.researchSign, tileX: 51.3, baseTileY: 27, scale: 0.2502, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.researchTable, tileX: 57.7, baseTileY: 27.5, scale: 0.2502 },
  // Florist — Building 3 open-front stall (footprint x55-59, y35-38).
  { texture: CloverVillageTextureKeys.florist, tileX: 57.5, baseTileY: 39, scale: 0.6 },
  { texture: CloverVillageTextureKeys.floristSign, tileX: 60.7, baseTileY: 39, scale: 0.2502, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.flowerFront, tileX: 53.4, baseTileY: 39.5, scale: 0.2503 },
  // Cottages — background residences.
  { texture: CloverVillageTextureKeys.cottageNorthWest, tileX: 15.5, baseTileY: 47, scale: 0.28 },
  { texture: CloverVillageTextureKeys.cottageNorthEast, tileX: 56.5, baseTileY: 48, scale: 0.28 },
  // Cottage clotheslines (reference look: laundry airing by each home).
  { texture: CloverVillageTextureKeys.clothesline, tileX: 13.8, baseTileY: 49.2, scale: 0.2499, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.clothesline, tileX: 58.8, baseTileY: 49.3, scale: 0.2499, depthOffset: 0.02, flipX: true },

  // --- 2. Courier Square (plaza at 37,28 r7.6; spawn 37,31 stays clear) ----
  { texture: CloverVillageTextureKeys.bench, tileX: 34.6, baseTileY: 27.9, scale: 0.2499 },
  { texture: CloverVillageTextureKeys.bench, tileX: 40.2, baseTileY: 33.4, scale: 0.2272 },
  { texture: CloverVillageTextureKeys.bench, tileX: 44.6, baseTileY: 48.6, scale: 0.2272 },
  { texture: CloverVillageTextureKeys.bench, tileX: 34.8, baseTileY: 49.6, scale: 0.2272 },
  { texture: CloverVillageTextureKeys.courierBanner, tileX: 30.4, baseTileY: 30.4, scale: 0.2308 },
  // Mailbox (object-mailbox at 33,30) — new CloverValley mailbox cutout.
  { texture: CloverVillageTextureKeys.mailbox, tileX: 33.4, baseTileY: 31, scale: 0.2499 },
  // Quest Board (object-quest-board at 41,30) — decor_9 notice board.
  { texture: CloverVillageTextureKeys.questBoard, tileX: 41.6, baseTileY: 30.2, scale: 0.34 },
  // Lost-item clutter from the quest-items sheet: Pip's letter opener dropped
  // by the Post Office counter, Moss's polished pebble on the cottage lawns.
  { texture: CloverVillageTextureKeys.questItems, frame: "letterOpener", tileX: 42.9, baseTileY: 22.9, scale: 1.08 },
  { texture: CloverVillageTextureKeys.questItems, frame: "polishedPebble", tileX: 16.2, baseTileY: 48.4, scale: 1.2, flipX: true },
  { texture: CloverVillageTextureKeys.questItemsAlt, tileX: 67.2, baseTileY: 59.6, scale: 0.2501 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 30.6, baseTileY: 25.2, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 43.4, baseTileY: 25.2, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 30.6, baseTileY: 32.4, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 43.4, baseTileY: 32.4, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 31.2, baseTileY: 28.6, scale: 1.1 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 42.8, baseTileY: 28.2, scale: 0.7 },
  { texture: CloverVillageTextureKeys.stones, tileX: 40.9, baseTileY: 26.2, scale: 0.85, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesAlt, tileX: 32.2, baseTileY: 33.8, scale: 0.8, depthOffset: 0.01 },

  // --- 3. Routes: lantern-lined roads + banner moments ---------------------
  // North road (x37-38, y3-21) + welcome moment at the forest edge.
  { texture: CloverVillageTextureKeys.lampPost, tileX: 35.6, baseTileY: 12, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 39.4, baseTileY: 16, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.courierBanner, tileX: 40.5, baseTileY: 8.8, scale: 0.2116 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 34.8, baseTileY: 9.4, scale: 1.0 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 41.2, baseTileY: 12.6, scale: 1.2 },
  // South road (x37-38, y36-74).
  { texture: CloverVillageTextureKeys.lampPost, tileX: 35.6, baseTileY: 40, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 39.4, baseTileY: 44, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 35.6, baseTileY: 52, scale: 0.2354 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 39.4, baseTileY: 60, scale: 0.2354 },
  // Southern gate (y70-74) — banner arch + twin lamps.
  { texture: CloverVillageTextureKeys.courierBanner, tileX: 40.6, baseTileY: 69.2, scale: 0.25 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 34.2, baseTileY: 69.4, scale: 0.2501 },
  { texture: CloverVillageTextureKeys.lampPost, tileX: 41.8, baseTileY: 69.4, scale: 0.2501 },
  // Grand wooden gate arch (reference look) framing the Happy Valley exit —
  // stone pillar bases, lanterns, white banner with the clover emblem.
  { texture: CloverVillageTextureKeys.entranceArch, tileX: 37.5, baseTileY: 72.5, scale: 0.2999, depthOffset: 0.03 },
  // Directional Signpost — LAST, on the south verge beside the Happy Valley
  // transition tile (37,74). Wired from decor_4 (the catalog's only signpost).
  { texture: CloverVillageTextureKeys.signpost, tileX: 34.9, baseTileY: 72.6, scale: 0.4, flipX: true },
  // East arm + southeast connector dressing.
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 47.5, baseTileY: 26.2, scale: 0.75 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 44.8, baseTileY: 38.4, scale: 0.95 },
  { texture: CloverVillageTextureKeys.stonesThird, tileX: 45.6, baseTileY: 35.2, scale: 0.75, depthOffset: 0.01 },

  // --- 4. Moss's Garden — open fenced garden (x40-52, y40-47) --------------
  { texture: CloverVillageTextureKeys.gardenProp, tileX: 45, baseTileY: 44, scale: 0.2497 },
  // Raised vegetable beds (reference look: fenced garden with rows of crops).
  { texture: CloverVillageTextureKeys.gardenBed, tileX: 44, baseTileY: 43.4, scale: 0.2498, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.gardenBed, tileX: 48.2, baseTileY: 43.5, scale: 0.2498, depthOffset: 0.02, flipX: true },
  { texture: CloverVillageTextureKeys.gardenBed, tileX: 46.8, baseTileY: 44.4, scale: 0.2498, depthOffset: 0.02 },
  { texture: CloverVillageTextureKeys.gardenBed, tileX: 49, baseTileY: 46.2, scale: 0.2498, depthOffset: 0.02, flipX: true },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 42.2, baseTileY: 41.4, scale: 0.65 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 49.8, baseTileY: 45.8, scale: 0.9 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 50.6, baseTileY: 41.6, scale: 1.1 },
  { texture: CloverVillageTextureKeys.stones, tileX: 42.6, baseTileY: 46.2, scale: 0.7, depthOffset: 0.01 },

  // --- 5. NW pond + Rabbit Burrow clearing ---------------------------------
  { texture: CloverVillageTextureKeys.pondArea, tileX: 7.5, baseTileY: 11.8, scale: 0.2498 },
  { texture: CloverVillageTextureKeys.bridge, tileX: 8.5, baseTileY: 12.3, scale: 0.25 },
  // Lily pads floating on the pond water (reference look).
  { texture: CloverVillageTextureKeys.lilyPads, tileX: 8.5, baseTileY: 9.5, scale: 0.2, depthOffset: 0.015 },
  { texture: CloverVillageTextureKeys.lilyPads, tileX: 9.6, baseTileY: 6.4, scale: 0.2, depthOffset: 0.015, flipX: true },
  { texture: CloverVillageTextureKeys.lilyPads, tileX: 7.5, baseTileY: 10.5, scale: 0.2, depthOffset: 0.015 },
  { texture: CloverVillageTextureKeys.pondArea, tileX: 10.4, baseTileY: 5.2, scale: 0.2029 },
  { texture: CloverVillageTextureKeys.rabbitBurrow, tileX: 18.6, baseTileY: 11.4, scale: 0.2499 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 20.8, baseTileY: 9.6, scale: 1.0 },
  { texture: CloverVillageTextureKeys.stonesAlt, tileX: 15.2, baseTileY: 11.8, scale: 0.85, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesThird, tileX: 21.4, baseTileY: 12.2, scale: 0.8, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.tree, tileX: 13, baseTileY: 8.5, scale: 0.27 },

  // --- 6. Hollow Oak clearing (discovery trail, southwest) ------------------
  { texture: CloverVillageTextureKeys.hollowOak, tileX: 13.5, baseTileY: 60.8, scale: 0.2502 },
  // The legendary golden acorn glinting at the oak's base (quest item art).
  { texture: CloverVillageTextureKeys.questItems, frame: "goldenAcorn", tileX: 14.3, baseTileY: 59.6, scale: 0.84 },
  { texture: CloverVillageTextureKeys.stones, tileX: 11.2, baseTileY: 60.4, scale: 0.9, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesThird, tileX: 16.2, baseTileY: 59.6, scale: 0.8, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 10.8, baseTileY: 58.6, scale: 0.85 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 16.6, baseTileY: 61.4, scale: 1.15 },

  // --- 7. SE pond + picnic clearing ----------------------------------------
  // Shore cluster beside the object-pond-edge marker (49,56) so the pond art
  // reaches the marker's bank rather than sitting far off-center.
  { texture: CloverVillageTextureKeys.pondArea, tileX: 50.4, baseTileY: 56.6, scale: 0.1561 },
  // Lumi's moonlight notebook, dropped on the pond-edge shore (quest item art).
  { texture: CloverVillageTextureKeys.questItems, frame: "moonNotebook", tileX: 49.6, baseTileY: 57, scale: 0.9, flipX: true },
  { texture: CloverVillageTextureKeys.pondArea, tileX: 53, baseTileY: 57.6, scale: 0.2498 },
  { texture: CloverVillageTextureKeys.pondArea, tileX: 58.5, baseTileY: 68.6, scale: 0.2341 },
  { texture: CloverVillageTextureKeys.bridge, tileX: 52.4, baseTileY: 57.4, scale: 0.2143 },
  // Lily pads on the pond water (reference look).
  { texture: CloverVillageTextureKeys.lilyPads, tileX: 55.5, baseTileY: 58.5, scale: 0.2, depthOffset: 0.015 },
  { texture: CloverVillageTextureKeys.lilyPads, tileX: 53.5, baseTileY: 60.5, scale: 0.2, depthOffset: 0.015, flipX: true },
  { texture: CloverVillageTextureKeys.lilyPads, tileX: 57.5, baseTileY: 60.5, scale: 0.2, depthOffset: 0.015 },
  { texture: CloverVillageTextureKeys.picnic, tileX: 65.5, baseTileY: 57.8, scale: 0.2499 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 68.5, baseTileY: 54.5, scale: 0.26 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 62.4, baseTileY: 56.2, scale: 0.7 },
  { texture: CloverVillageTextureKeys.stones, tileX: 60.8, baseTileY: 66.8, scale: 0.75, depthOffset: 0.01 },

  // --- 8. Storybook trees framing the village ------------------------------
  { texture: CloverVillageTextureKeys.tree, tileX: 26, baseTileY: 20.5, scale: 0.27 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 49, baseTileY: 22.5, scale: 0.29 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 28.5, baseTileY: 43.5, scale: 0.26 },
  { texture: CloverVillageTextureKeys.tree, tileX: 47.5, baseTileY: 36.8, scale: 0.25 },
  { texture: CloverVillageTextureKeys.tree, tileX: 33, baseTileY: 51.5, scale: 0.25 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 42.5, baseTileY: 52.5, scale: 0.24 },
  { texture: CloverVillageTextureKeys.tree, tileX: 24.5, baseTileY: 33.5, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 50.5, baseTileY: 33.5, scale: 0.24 },

  // --- 9. Vegetation + stone scatter along the routes ----------------------
  { texture: CloverVillageTextureKeys.greenery, tileX: 21.5, baseTileY: 24.5, scale: 1.0 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 45.5, baseTileY: 30.8, scale: 0.7 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 30.5, baseTileY: 37.5, scale: 0.8 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 52.5, baseTileY: 36.5, scale: 0.95 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 43.5, baseTileY: 49.5, scale: 0.9 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 31.5, baseTileY: 47.5, scale: 1.1 },
  { texture: CloverVillageTextureKeys.greeneryAlt, tileX: 34.5, baseTileY: 56.5, scale: 0.75 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 41.5, baseTileY: 64.5, scale: 0.8 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 33.5, baseTileY: 66.5, scale: 0.95 },
  { texture: CloverVillageTextureKeys.stones, tileX: 36.2, baseTileY: 21.4, scale: 0.8, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesAlt, tileX: 39.8, baseTileY: 27.4, scale: 0.7, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesThird, tileX: 34.2, baseTileY: 43.5, scale: 0.7, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stones, tileX: 40.2, baseTileY: 55.5, scale: 0.8, depthOffset: 0.01 },
  { texture: CloverVillageTextureKeys.stonesAlt, tileX: 35.8, baseTileY: 64.5, scale: 0.75, depthOffset: 0.01 },

  // --- 10. Forest canopy ring (reference look: dense tree boundary) --------
  // Greedy spread over the map-edge grass tiles (>=4 tiles apart), clear of
  // interactables/spawn/transitions, mixed tree + greenery variants.
  { texture: CloverVillageTextureKeys.tree, tileX: 5, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 11, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 15, baseTileY: 4, scale: 0.85 },
  { texture: CloverVillageTextureKeys.tree, tileX: 19, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 23, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 27, baseTileY: 4, scale: 0.9 },
  { texture: CloverVillageTextureKeys.tree, tileX: 31, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 35, baseTileY: 4, scale: 0.75 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 39, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 43, baseTileY: 4, scale: 1 },
  { texture: CloverVillageTextureKeys.tree, tileX: 47, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 51, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 55, baseTileY: 4, scale: 0.85 },
  { texture: CloverVillageTextureKeys.tree, tileX: 59, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 63, baseTileY: 4, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 67, baseTileY: 4, scale: 0.9 },
  { texture: CloverVillageTextureKeys.tree, tileX: 4, baseTileY: 8, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 69, baseTileY: 8, scale: 0.75 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 4, baseTileY: 12, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 70, baseTileY: 12, scale: 1 },
  { texture: CloverVillageTextureKeys.tree, tileX: 4, baseTileY: 16, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 70, baseTileY: 16, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 4, baseTileY: 20, scale: 0.85 },
  { texture: CloverVillageTextureKeys.tree, tileX: 4, baseTileY: 24, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 70, baseTileY: 26, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 4, baseTileY: 28, scale: 0.9 },
  { texture: CloverVillageTextureKeys.tree, tileX: 70, baseTileY: 30, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 4, baseTileY: 32, scale: 0.75 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 70, baseTileY: 34, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 4, baseTileY: 36, scale: 1 },
  { texture: CloverVillageTextureKeys.tree, tileX: 69, baseTileY: 38, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 4, baseTileY: 40, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 69, baseTileY: 43, scale: 0.85 },
  { texture: CloverVillageTextureKeys.tree, tileX: 4, baseTileY: 44, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 69, baseTileY: 47, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 5, baseTileY: 48, scale: 0.9 },
  { texture: CloverVillageTextureKeys.tree, tileX: 4, baseTileY: 52, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 69, baseTileY: 52, scale: 0.75 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 5, baseTileY: 56, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 69, baseTileY: 56, scale: 1 },
  { texture: CloverVillageTextureKeys.tree, tileX: 4, baseTileY: 60, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 69, baseTileY: 60, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 4, baseTileY: 64, scale: 0.85 },
  { texture: CloverVillageTextureKeys.tree, tileX: 69, baseTileY: 64, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 10, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 14, baseTileY: 67, scale: 0.9 },
  { texture: CloverVillageTextureKeys.tree, tileX: 19, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 26, baseTileY: 67, scale: 0.75 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 30, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFifth, tileX: 34, baseTileY: 67, scale: 1 },
  { texture: CloverVillageTextureKeys.tree, tileX: 39, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 43, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greenery, tileX: 47, baseTileY: 67, scale: 0.85 },
  { texture: CloverVillageTextureKeys.tree, tileX: 51, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 59, baseTileY: 67, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryFourth, tileX: 63, baseTileY: 67, scale: 0.9 },
  { texture: CloverVillageTextureKeys.tree, tileX: 5, baseTileY: 68, scale: 0.24 },
  { texture: CloverVillageTextureKeys.greeneryThird, tileX: 55, baseTileY: 68, scale: 0.75 },
  { texture: CloverVillageTextureKeys.treeAlt, tileX: 67, baseTileY: 68, scale: 0.24 },
];

/**
 * Fence runs are expanded into evenly spaced pieces so the perimeter code
 * stays readable. Horizontal runs march along +x; vertical runs rotate each
 * piece 90° and march along +y.
 */
interface FenceRun {
  texture: string;
  scale: number;
  /** Tile-space segment; horizontal runs step in x, vertical runs in y. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Piece stride in tiles (defaults to the art's visual width). */
  step?: number;
}

const FENCE_RUNS: readonly FenceRun[] = [
  // Garden perimeter (opening on the west side at y43).
  { texture: CloverVillageTextureKeys.fenceLongStraight, scale: 0.2497, x0: 40.6, y0: 39.8, x1: 52.4, y1: 39.8, step: 2.6 },
  { texture: CloverVillageTextureKeys.fenceLongStraight, scale: 0.2497, x0: 40.6, y0: 47.8, x1: 52.4, y1: 47.8, step: 2.6 },
  { texture: CloverVillageTextureKeys.fenceLongStraight, scale: 0.2497, x0: 52.6, y0: 40.2, x1: 52.6, y1: 47.6, step: 2.4 },
  { texture: CloverVillageTextureKeys.fenceStraight, scale: 0.2506, x0: 39.7, y0: 40.4, x1: 39.7, y1: 42.2, step: 1.8 },
  { texture: CloverVillageTextureKeys.fenceStraight, scale: 0.2506, x0: 39.7, y0: 44.2, x1: 39.7, y1: 47.2, step: 1.8 },
  { texture: CloverVillageTextureKeys.fenceCorner, scale: 0.2491, x0: 40.2, y0: 39.8, x1: 40.2, y1: 39.8 },
  { texture: CloverVillageTextureKeys.fenceCorner, scale: 0.2491, x0: 52.4, y0: 39.8, x1: 52.4, y1: 39.8 },
  { texture: CloverVillageTextureKeys.fenceCorner, scale: 0.2491, x0: 52.4, y0: 47.8, x1: 52.4, y1: 47.8 },
  { texture: CloverVillageTextureKeys.fenceGate, scale: 0.25, x0: 39.7, y0: 43.2, x1: 39.7, y1: 43.2 },
  // NW cottage lawn dressing.
  { texture: CloverVillageTextureKeys.fenceStraight, scale: 0.2327, x0: 12.6, y0: 47.6, x1: 14, y1: 47.6, step: 1.5 },
  { texture: CloverVillageTextureKeys.fencePost, scale: 0.2493, x0: 17.2, y0: 47.4, x1: 17.2, y1: 47.4 },
  // NE cottage lawn dressing.
  { texture: CloverVillageTextureKeys.fenceStraight, scale: 0.2327, x0: 58.2, y0: 48.6, x1: 59.6, y1: 48.6, step: 1.5 },
  { texture: CloverVillageTextureKeys.fencePost, scale: 0.2493, x0: 54.4, y0: 48.4, x1: 54.4, y1: 48.4 },
  // Burrow clearing — broken-post charm at the trailhead.
  { texture: CloverVillageTextureKeys.fenceAngleLeft, scale: 0.2487, x0: 14.6, y0: 12.6, x1: 16.2, y1: 12.6, step: 1.7 },
  { texture: CloverVillageTextureKeys.fenceAngleRight, scale: 0.2505, x0: 20.4, y0: 12.8, x1: 22, y1: 12.8, step: 1.7 },
  // Burrow trailhead: one broken post and a short patched section — the
  // clearings boundary has seen some rabbit weather.
  { texture: CloverVillageTextureKeys.fencePostBroken, scale: 0.2486, x0: 23.6, y0: 12.9, x1: 23.6, y1: 12.9 },
  { texture: CloverVillageTextureKeys.fenceShortStraight, scale: 0.2304, x0: 11.2, y0: 12.6, x1: 13.2, y1: 12.6, step: 2 },
  // Cottage lawns: a leaning broken post and a short section continuing the
  // straight run, so the alternates read as age rather than absence.
  { texture: CloverVillageTextureKeys.fencePostBroken, scale: 0.2279, x0: 12.1, y0: 47.6, x1: 12.1, y1: 47.6 },
  { texture: CloverVillageTextureKeys.fenceShortStraight, scale: 0.2496, x0: 60.1, y0: 48.6, x1: 61.1, y1: 48.6, step: 1 },
  // South road verge before the gate.
  { texture: CloverVillageTextureKeys.fenceStraight, scale: 0.2148, x0: 33.6, y0: 67.4, x1: 35.2, y1: 67.4, step: 1.6 },
];

/** Expand fence runs into individual set-piece placements. */
function expandFenceRuns(runs: readonly FenceRun[]): CloverVillageSetPieceDefinition[] {
  const pieces: CloverVillageSetPieceDefinition[] = [];
  for (const run of runs) {
    const horizontal = Math.abs(run.x1 - run.x0) >= Math.abs(run.y1 - run.y0);
    const length = horizontal
      ? Math.abs(run.x1 - run.x0)
      : Math.abs(run.y1 - run.y0);
    const step = run.step ?? 2;
    const rotation = horizontal ? 0 : Math.PI / 2;
    // Zero-length runs are single-point placements (corners, gates).
    if (length === 0) {
      pieces.push({
        texture: run.texture,
        tileX: run.x0,
        baseTileY: run.y0,
        scale: run.scale,
        rotation,
        depthOffset: 0.005,
      });
      continue;
    }
    const count = Math.max(1, Math.round(length / step));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = run.x0 + (run.x1 - run.x0) * t;
      const y = run.y0 + (run.y1 - run.y0) * t;
      pieces.push({
        texture: run.texture,
        tileX: x,
        baseTileY: y,
        scale: run.scale,
        rotation,
        depthOffset: 0.005,
      });
    }
  }
  return pieces;
}

for (const piece of expandFenceRuns(FENCE_RUNS)) SET_PIECES.push(piece);

export function getCloverVillageSetPieceDefinitions(): readonly CloverVillageSetPieceDefinition[] {
  return SET_PIECES;
}
