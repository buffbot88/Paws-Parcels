/**
 * The scene's live entities, read into billboard descriptions for the 3D world.
 *
 * This is the whole bridge between simulation and the 3D frame: entities keep
 * being Phaser objects that the network and the input system already move, and
 * each is measured through the shared entity-sizing convention rather than by a
 * number chosen here.
 */
import Phaser from "phaser";
import { TextureKeys } from "../game/GameConstants.ts";
import {
  CREATURE_SIZING,
  courierSizing,
  entityContactWidthPx,
  entityFeetOffsetPx,
  villagerSizing,
  type EntitySizing,
} from "../game/entitySizing.ts";
import { npcArtForDefinition } from "../game/cloverVillageNpcAssets.ts";
import { Monster } from "../entities/Monster.ts";
import { NPC } from "../entities/NPC.ts";
import { Player } from "../entities/Player.ts";
import { RemotePlayer } from "../entities/RemotePlayer.ts";
import { TILE_SIZE } from "../game/GameConfig.ts";
import type { EntityBillboard } from "./characters3d.ts";

type Art = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
type Placed = Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;

interface View {
  /** The object carrying the world position: the sprite, or the container. */
  readonly object: Placed;
  readonly art: Art;
  readonly sizing: EntitySizing;
  readonly tint: number;
}

/** The art a container draws, which is its sprite-shaped child. */
function artIn(container: Phaser.GameObjects.Container): Art | null {
  for (const child of container.list) {
    if (child instanceof Phaser.GameObjects.Sprite || child instanceof Phaser.GameObjects.Image) {
      return child;
    }
  }
  return null;
}

/** Resolve one Phaser object into the art and sizing the 3D world needs. */
function viewOf(object: Phaser.GameObjects.GameObject): View | null {
  if (object instanceof Player) {
    return { object, art: object, sizing: object.sizing, tint: 0xffffff };
  }
  if (object instanceof NPC) {
    return {
      object,
      art: object,
      sizing: villagerSizing(npcArtForDefinition(object.definition)),
      tint: 0xffffff,
    };
  }
  if (object instanceof Monster) {
    const art = artIn(object);
    return art === null
      ? null
      : {
          object,
          art,
          sizing: CREATURE_SIZING,
          tint: art.isTinted ? art.tintTopLeft : 0xffffff,
        };
  }
  if (object instanceof RemotePlayer) {
    const art = artIn(object);
    return art === null
      ? null
      : {
          object,
          art,
          sizing: courierSizing(object.classKey, art.texture.key !== TextureKeys.NpcBlob),
          tint: 0xffffff,
        };
  }
  return null;
}

/** Every entity the 3D world should draw, in scene order. */
export function entityBillboards(
  children: readonly Phaser.GameObjects.GameObject[],
  tilePx = TILE_SIZE,
): EntityBillboard[] {
  const billboards: EntityBillboard[] = [];
  for (const child of children) {
    const view = viewOf(child);
    if (view === null) continue;
    const { object, art, sizing } = view;
    const frame = art.frame;
    if (frame === undefined) continue;
    const visible = object.visible && art.visible;
    billboards.push({
      id: object,
      x: object.x / tilePx,
      z: object.y / tilePx,
      centreAboveFeetTiles: entityFeetOffsetPx(sizing) / tilePx,
      imageKey: art.texture.key,
      frame: {
        cutX: frame.cutX,
        cutY: frame.cutY,
        cutWidth: frame.cutWidth,
        cutHeight: frame.cutHeight,
        sourceWidth: frame.source.width,
        sourceHeight: frame.source.height,
      },
      widthTiles: Math.abs(art.displayWidth) / tilePx,
      heightTiles: Math.abs(art.displayHeight) / tilePx,
      flipX: art.flipX === true,
      footprintPx: entityContactWidthPx(sizing),
      tint: view.tint,
      visible,
    });
  }
  return billboards;
}
