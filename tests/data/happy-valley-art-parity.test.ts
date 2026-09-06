import { describeInteractableArtParity } from "./interactable-art-parity-harness.ts";
import happyValleyJson from "../../src/data/maps/happy-valley.json";
import {
  HappyValleyTextureKeys,
  getHappyValleySetPieceDefinitions,
} from "../../src/game/happyValleyPlacements.ts";

/**
 * Happy Valley interactable-art parity. The valley's three sign interactables
 * previously rendered as bare marker circles; this locks dedicated art beside
 * each of them.
 */

describeInteractableArtParity({
  mapName: "happy valley",
  interactables: happyValleyJson.interactables,
  allTextureKeys: Object.values(HappyValleyTextureKeys),
  surfaceKeys: [HappyValleyTextureKeys.ground, HappyValleyTextureKeys.path],
  artMappings: {
    // The arrival meadow is announced by the blue banner beside the sign.
    "object-valley-welcome": [HappyValleyTextureKeys.blueBanner],
    // The pond-sign clearing is dressed with short shore art (water sits at y9).
    "object-valley-pond-sign": [
      HappyValleyTextureKeys.treeStumpShort,
      HappyValleyTextureKeys.rock02,
      HappyValleyTextureKeys.rock04,
    ],
    // The blueberry patch is embodied by the bush cluster around the sign.
    "object-valley-blueberries": [
      HappyValleyTextureKeys.bushLarge,
      HappyValleyTextureKeys.bushSmall,
      HappyValleyTextureKeys.bushMedium,
    ],
  },
  definitions: getHappyValleySetPieceDefinitions(),
});
