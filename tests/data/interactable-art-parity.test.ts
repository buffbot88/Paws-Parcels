import {
  describeInteractableArtParity,
  terrainSurfaceKeys,
} from "./interactable-art-parity-harness.ts";
import cloverVillageJson from "../../src/data/maps/clover-village.json";
import {
  CLOVER_VILLAGE_QUEST_ITEM_FRAMES,
  CLOVER_VILLAGE_TERRAIN,
  CloverVillageTextureKeys,
  getCloverVillageSetPieceDefinitions,
} from "../../src/game/cloverVillagePlacements.ts";

/**
 * Interactable-art parity for Clover Village, via the shared harness that also
 * covers Happy Valley. Every clover-village interactable tile must have
 * dedicated set-piece art placed adjacent to it — the same guarantee the
 * original standalone test enforced, now applied identically to every mapped
 * zone.
 */

describeInteractableArtParity({
  mapName: "clover village",
  interactables: cloverVillageJson.interactables,
  allTextureKeys: Object.values(CloverVillageTextureKeys),
  // The authored surface (base, road, plaza, grass islands, fringe kit) is
  // drawn by the shared terrain renderer, deliberately not as set pieces —
  // everything else must appear in the world.
  surfaceKeys: terrainSurfaceKeys(CLOVER_VILLAGE_TERRAIN),
  artMappings: {
    // Post Office counter + corner share the building's art.
    "object-counter": [CloverVillageTextureKeys.postOffice],
    "object-post-counter": [CloverVillageTextureKeys.postOffice],
    "object-quest-board": [CloverVillageTextureKeys.questBoard],
    "object-mailbox": [CloverVillageTextureKeys.mailbox],
    "object-shop": [CloverVillageTextureKeys.shop],
    // The welcome moment is marked with a courier banner at the forest edge.
    "object-welcome-sign": [CloverVillageTextureKeys.courierBanner],
    "object-rabbit-burrows": [CloverVillageTextureKeys.rabbitBurrow],
    "object-pond-edge": [CloverVillageTextureKeys.pondArea],
    "object-hollow-oak": [CloverVillageTextureKeys.hollowOak],
    "object-picnic-blanket": [CloverVillageTextureKeys.picnic],
  },
  definitions: getCloverVillageSetPieceDefinitions(),
  sheetFrames: CLOVER_VILLAGE_QUEST_ITEM_FRAMES,
});
