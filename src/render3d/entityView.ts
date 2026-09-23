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
import type { EntityBillboard, EntityTag } from "./characters3d.ts";
import { MONSTER_HP_BAR } from "./labels3d.ts";

type Art = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
type Placed = Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;

/**
 * The presentation objects every entity already owns.
 *
 * Read rather than re-authored: the name tag is a Phaser text object each
 * entity class creates with its own typography, and the 3D frame uploads that
 * object's canvas instead of typesetting the name a second time. The fields are
 * private to the classes on purpose — nothing outside should write them — so
 * this reads them the same way the e2e probes read live scene state.
 */
interface TagCarrier {
  readonly nameTag?: Phaser.GameObjects.Text;
  readonly hpBar?: Phaser.GameObjects.Rectangle;
}

/** Clearance a name tag keeps above the figure's head, as the entities author it. */
const NAME_TAG_MARGIN_PX = 6;

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

/** An entity's name tag as the 3D layer needs it (null when it has none). */
function tagOf(object: Phaser.GameObjects.GameObject): EntityTag | null {
  const tag = (object as unknown as TagCarrier).nameTag;
  if (tag === undefined || tag.canvas === undefined) return null;
  const style = tag.style;
  return {
    canvas: tag.canvas,
    // The contents, so a renamed villager or a levelled-up courier re-uploads
    // instead of showing the words they had when the texture was built.
    key: [tag.text, tag.width, tag.height, style?.color ?? "", style?.backgroundColor ?? ""]
      .join("|"),
    widthPx: tag.width,
    heightPx: tag.height,
    alpha: tag.alpha,
  };
}

/**
 * An entity's health bar, as the share of full the sprite renderer already draws.
 *
 * `Monster.setHp` resizes the bar to `36 * ratio` and recolours it from the same
 * server HP the client mirrors, so the 3D bar reads the same share in the same
 * colour ramp. A bar the entity has hidden is not a bar.
 */
function hpOf(object: Phaser.GameObjects.GameObject): { ratio: number; colour: number } | null {
  const bar = (object as unknown as TagCarrier).hpBar;
  if (bar === undefined || !bar.visible) return null;
  return {
    ratio: Math.max(0, Math.min(1, bar.width / MONSTER_HP_BAR.widthPx)),
    colour: bar.fillColor,
  };
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
    const hp = hpOf(object);
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
      tag: tagOf(object),
      // Measured from the shared sizing rule, so a tag rides the figure's own
      // height instead of a number guessed here — and, because it is the
      // *intended* height rather than the current animation frame, it does not
      // bob up and down as the courier walks.
      tagAboveFeetTiles: sizing.tiles + NAME_TAG_MARGIN_PX / tilePx,
      hpRatio: hp === null ? null : hp.ratio,
      hpColour: hp === null ? 0x66bb66 : hp.colour,
    });
  }
  return billboards;
}
