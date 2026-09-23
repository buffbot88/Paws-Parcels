import Phaser from "phaser";
import { TextureKeys } from "../game/GameConstants.ts";
import {
  animationKey,
  classKeyFromId,
  classSpeed,
  type ClassKey,
  type SpriteDirection,
} from "../game/classAssets.ts";
import type { MoveVector } from "../systems/InputSystem.ts";
import { DEPTH_OFFSET, worldDepth } from "../game/WorldDepth.ts";
import {
  courierSizing,
  entityFeetOffsetPx,
  entityNameTagOffsetPx,
  entityScale,
  type EntitySizing,
} from "../game/entitySizing.ts";

export type Facing = "down" | "up" | "left" | "right";

function directionForFacing(facing: Facing): SpriteDirection {
  if (facing === "down") return "south";
  if (facing === "up") return "north";
  return facing === "left" ? "west" : "east";
}

/** A server-selected class-aware local courier with an authoritative physics body. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  static readonly BODY_WIDTH = 28;
  static readonly BODY_HEIGHT = 20;

  /**
   * Shared nameplate style. The tag is the way every other player identifies
   * this courier, so it must be readable over any tile art: heavy dark type on
   * an opaque cream chip with a dark stroke, not the translucent wash a villager
   * can afford. RemotePlayer mirrors it so the whole cast reads as one rule.
   */
  static readonly NAME_TAG_STYLE = {
    fontFamily: "Georgia, serif",
    fontSize: "15px",
    color: "#2b1d0f",
    backgroundColor: "#fff8ec",
    padding: { x: 7, y: 3 },
    stroke: "#2b1d0f",
    strokeThickness: 3,
  } as const;

  readonly classKey: ClassKey;
  /**
   * The courier's size row from the shared entity convention. Everything the
   * sprite's rendering needs — scale, feet offset, shadow — is derived from it,
   * so this class holds no scale or shadow numbers of its own.
   */
  readonly sizing: EntitySizing;
  /** Movement speed (px/s) matching the server's class speed — see classAssets.ts.
   * Raised to the gear-adjusted speed when the server's inventory snapshot
   * arrives, so speed gear renders (and the intent throttle matches). */
  private speed: number;
  facing: Facing = "down";
  private moving = false;
  private readonly attackCompleteHandler = (): void => this.playIdle();
  /**
   * The courier's own name, above their head.
   *
   * The local player used to be the one figure in the world without a label,
   * which reads as an oversight the moment anyone else is on screen with one.
   * It is created on demand (the name arrives from the character desk, after
   * the sprite exists) and styled like a remote courier's tag, because that is
   * exactly what it is: how the player is identified to the rest of the zone.
   */
  private nameTag: Phaser.GameObjects.Text | null = null;
  private nameTagOffsetY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, classId = 1) {
    const classKey = classKeyFromId(classId);
    const idleKey = animationKey(classKey, "idle", "south");
    super(scene, x, y, scene.textures.exists(idleKey) ? idleKey : TextureKeys.PlayerIdleDown);
    this.classKey = classKey;
    this.speed = classSpeed(classKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    (this.body as Phaser.Physics.Arcade.Body).setSize(
      Player.BODY_WIDTH,
      Player.BODY_HEIGHT,
    );
    // Sized by the shared entity convention rather than a literal: the courier
    // renders at 0.75 tiles of figure whether its class art is present or the
    // placeholder blob is standing in for it (see entitySizing.ts).
    this.sizing = courierSizing(classKey, this.texture.key !== TextureKeys.PlayerIdleDown);
    this.setScale(entityScale(this.sizing));
    this.setDepth(worldDepth(this.y));
    this.playIfAvailable("idle", "south");
  }

  /** Pixels below the courier's centre where its feet (and cast shadow) sit. */
  get feetOffsetPx(): number {
    return entityFeetOffsetPx(this.sizing);
  }

  /** Show this courier's name above their head. Ignored for a blank name. */
  setDisplayName(name: string): void {
    const label = name.trim();
    if (label === "") return;
    this.nameTagOffsetY = entityNameTagOffsetPx(this.sizing);
    this.nameTag = this.scene.add
      .text(this.x, this.y + this.nameTagOffsetY, label, Player.NAME_TAG_STYLE)
      .setOrigin(0.5)
      .setDepth(worldDepth(this.y, DEPTH_OFFSET.overlay));
  }

  /** Keep the name over the courier as they move. */
  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (this.nameTag === null) return;
    this.nameTag.setPosition(this.x, this.y + this.nameTagOffsetY);
    this.nameTag.setDepth(worldDepth(this.y, DEPTH_OFFSET.overlay));
  }

  /** Adjust the rendered speed to the server's gear-adjusted px/s. */
  setSpeed(pxPerSecond: number): void {
    if (Number.isFinite(pxPerSecond) && pxPerSecond > 0) {
      this.speed = pxPerSecond;
    }
  }

  move(vector: MoveVector): void {
    this.setVelocity(vector.x * this.speed, vector.y * this.speed);
    this.setDepth(worldDepth(this.y));
    const moving = vector.x !== 0 || vector.y !== 0;
    if (!moving) {
      if (this.moving) this.playIfAvailable("idle", directionForFacing(this.facing));
      this.moving = false;
      return;
    }
    this.moving = true;
    if (Math.abs(vector.x) >= Math.abs(vector.y)) {
      this.facing = vector.x < 0 ? "left" : "right";
    } else {
      this.facing = vector.y < 0 ? "up" : "down";
    }
    this.playIfAvailable("walk", directionForFacing(this.facing));
  }

  playAttack(): void {
    this.moving = false;
    this.setVelocity(0, 0);
    const direction = directionForFacing(this.facing);
    const key = animationKey(this.classKey, "attack", direction);
    if (!this.scene.anims.exists(key)) return;
    this.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.attackCompleteHandler);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, this.attackCompleteHandler);
    this.play(key);
  }

  playDeath(): void {
    this.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.attackCompleteHandler);
    this.moving = false;
    this.setVelocity(0, 0);
    this.playIfAvailable("death", directionForFacing(this.facing));
  }

  playIdle(): void {
    this.playIfAvailable("idle", directionForFacing(this.facing));
  }

  private playIfAvailable(
    animation: "idle" | "walk" | "attack" | "death",
    direction: SpriteDirection,
  ): void {
    const key = animationKey(this.classKey, animation, direction);
    if (!this.scene.anims.exists(key)) return;
    if (this.anims.currentAnim?.key === key && this.anims.isPlaying) return;
    this.play(key);
  }
}
