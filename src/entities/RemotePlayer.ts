import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { TextureKeys } from "../game/GameConstants.ts";
import {
  animationKey,
  classKeyFromId,
  type ClassKey,
  type SpriteDirection,
} from "../game/classAssets.ts";
import type { NetPlayerInfo } from "../net/GameSocket.ts";
import { Player, walkBobPx } from "./Player.ts";
import { getSettings } from "../ui/settings.ts";
import { worldDepth } from "../game/WorldDepth.ts";
import {
  courierSizing,
  entityShadowOffsetPx,
  entityNameTagOffsetPx,
  entityScale,
  entityShadow,
} from "../game/entitySizing.ts";
import { PositionSampleBuffer } from "../net/positionInterpolation.ts";
import { BODY_ART_CLASS, resolveLook } from "../game/appearance.ts";
import { ensureLookArt } from "../game/avatarTextures.ts";

const INTERPOLATION_DELAY_MS = 100;

type Facing = "north" | "south" | "east" | "west";

function facingForDelta(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "west" : "east";
  return dy < 0 ? "north" : "south";
}

/** A remote courier using the server-provided class key and smooth snapshots. */
export class RemotePlayer extends Phaser.GameObjects.Container {
  readonly characterId: number;
  readonly classKey: ClassKey;
  private readonly samples = new PositionSampleBuffer();
  private nameTag: Phaser.GameObjects.Text;
  private sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private facing: Facing = "south";
  /** Which art this courier animates: its class art, or a recoloured look. */
  private artId: string;
  /** The class art the look's body is drawn from; sizes the figure. */
  artClass: ClassKey;
  /** Tag height, derived from the courier's figure rather than hand-placed. */
  private nameTagY: number;
  /** Walk hop height in pixels, drawn by the 3D renderer only. */
  bobY = 0;

  constructor(scene: Phaser.Scene, info: NetPlayerInfo) {
    const px = info.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = info.pos.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.characterId = info.characterId;
    this.classKey = classKeyFromId(info.classKey === "cat-mage" ? 2 : info.classKey === "fox-archer" ? 3 : 1);
    this.samples.add({ at: Date.now(), x: px, y: py });

    const look = resolveLook(info.appearance, this.classKey);
    this.artId = ensureLookArt(scene, look);
    this.artClass = BODY_ART_CLASS[look.body];
    const idleKey = animationKey(this.artId, "idle", "south");
    const authoredArt = scene.textures.exists(idleKey);
    // The same convention row the local courier uses, so a remote courier and
    // the one you are driving cannot disagree about how big a courier is.
    const sizing = courierSizing(this.artClass, authoredArt);
    this.sprite = scene.add
      .sprite(0, 0, authoredArt ? idleKey : TextureKeys.NpcBlob)
      .setScale(entityScale(sizing));
    const recipe = entityShadow(sizing);
    const shadow = (this.shadow = scene.add.ellipse(
      0,
      entityShadowOffsetPx(sizing),
      recipe.widthPx,
      recipe.heightPx,
      recipe.color,
      recipe.alpha,
    ));
    this.nameTagY = entityNameTagOffsetPx(sizing);
    // The local courier's plate style (Player.NAME_TAG_STYLE): a courier is
    // identified the same way whether you drive it or meet it, and both tags
    // must read over any tile art.
    this.nameTag = scene.add
      .text(0, this.nameTagY, info.name, Player.NAME_TAG_STYLE)
      .setOrigin(0.5);

    this.add([shadow, this.sprite, this.nameTag]);
    this.setDepth(worldDepth(py));
    scene.add.existing(this);
    this.playAnimation("idle", this.facing);
  }

  /** Wear a new look (they visited the Salon): new art, and the new body's size. */
  setAppearance(appearance: unknown): void {
    const look = resolveLook(appearance, this.classKey);
    this.artId = ensureLookArt(this.scene, look);
    this.artClass = BODY_ART_CLASS[look.body];
    const sizing = courierSizing(this.artClass, true);
    this.sprite.setScale(entityScale(sizing));
    this.shadow.setY(entityShadowOffsetPx(sizing));
    this.nameTagY = entityNameTagOffsetPx(sizing);
    this.sprite.anims.stop();
    this.playAnimation("idle", this.facing);
  }

  /** Show or hide the name tag (the scene shows names near the courier or under the pointer). */
  showName(visible: boolean): void {
    this.nameTag.setVisible(visible);
  }

  setTarget(pos: { x: number; y: number }, sampleAt = Date.now()): void {
    const nextX = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const nextY = pos.y * TILE_SIZE + TILE_SIZE / 2;
    const latest = this.samples.latest();
    const fromX = latest?.x ?? this.x;
    const fromY = latest?.y ?? this.y;
    this.facing = facingForDelta(nextX - fromX, nextY - fromY, this.facing);
    // A large discontinuity is a correction, not movement. This covers
    // reconnects, missed zone state, and server recovery without animating
    // the courier across the map from an obsolete sample.
    if (Math.max(Math.abs(nextX - fromX), Math.abs(nextY - fromY)) > TILE_SIZE * 3) {
      this.snapTo(pos, sampleAt);
      return;
    }
    this.samples.add({ at: sampleAt, x: nextX, y: nextY });
  }

  update(now = Date.now()): void {
    const rendered = this.samples.positionAt(now - INTERPOLATION_DELAY_MS);
    if (rendered === null) return;
    this.x = rendered.x;
    this.y = rendered.y;
    this.setDepth(worldDepth(this.y));
    this.nameTag.setPosition(0, this.nameTagY);
    this.playAnimation(rendered.moving ? "walk" : "idle", this.facing);
    this.bobY = rendered.moving && !getSettings().reducedMotion ? walkBobPx(now) : 0;
  }

  snapTo(pos: { x: number; y: number }, sampleAt = Date.now()): void {
    const x = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const y = pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.samples.clear();
    this.samples.add({ at: sampleAt, x, y });
    this.x = x;
    this.y = y;
    this.setDepth(worldDepth(y));
  }

  private playAnimation(animation: "idle" | "walk", direction: Facing): void {
    const key = animationKey(this.artId, animation, direction as SpriteDirection);
    if (!this.scene.anims.exists(key)) return;
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) return;
    this.sprite.play(key);
  }
}
