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
  entityShadowOffsetPx,
  entityNameTagOffsetPx,
  entityScale,
  type EntitySizing,
} from "../game/entitySizing.ts";
import { getSettings } from "../ui/settings.ts";

export type Facing = "down" | "up" | "left" | "right";

/** A walking courier's hop height in pixels at `timeMs`: a gentle bounce per step. */
export function walkBobPx(timeMs: number): number {
  return 2 * Math.abs(Math.sin(timeMs / 110));
}

function directionForFacing(facing: Facing): SpriteDirection {
  if (facing === "down") return "south";
  if (facing === "up") return "north";
  return facing === "left" ? "west" : "east";
}

/** A server-selected class-aware local courier with an authoritative physics body. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  /** Collision box in world px, fixed whatever scale the art renders at. */
  static readonly BODY_WIDTH = 37;
  static readonly BODY_HEIGHT = 27;

  /**
   * Shared nameplate style. The tag is the way every other player identifies
   * this courier, so it must be readable over any tile art: cream type with a
   * heavy dark outline and no chip, so it never hides the art behind it.
   * RemotePlayer mirrors it so the whole cast reads as one rule.
   */
  static readonly NAME_TAG_STYLE = {
    fontFamily: "Georgia, serif",
    fontSize: "15px",
    fontStyle: "bold",
    color: "#fff8ec",
    padding: { x: 3, y: 2 },
    stroke: "#2b1d0f",
    strokeThickness: 4,
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
  /** Walk hop height in pixels, drawn by the 3D renderer only. */
  bobY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, classId = 1) {
    const classKey = classKeyFromId(classId);
    const idleKey = animationKey(classKey, "idle", "south");
    super(scene, x, y, scene.textures.exists(idleKey) ? idleKey : TextureKeys.PlayerIdleDown);
    this.classKey = classKey;
    this.speed = classSpeed(classKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    // Sized by the shared entity convention rather than a literal: the courier
    // renders at the same figure height whether its class art is present or the
    // placeholder blob is standing in for it (see entitySizing.ts).
    this.sizing = courierSizing(classKey, this.texture.key !== TextureKeys.PlayerIdleDown);
    const scale = entityScale(this.sizing);
    this.setScale(scale);
    // Arcade scales the body with the sprite, so undo that to keep collision fixed.
    (this.body as Phaser.Physics.Arcade.Body).setSize(
      Player.BODY_WIDTH / scale,
      Player.BODY_HEIGHT / scale,
    );
    this.setDepth(worldDepth(this.y));
    this.playIfAvailable("idle", "south");
  }

  /** Pixels below the courier's centre where its cast shadow sits. */
  get shadowOffsetPx(): number {
    return entityShadowOffsetPx(this.sizing);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    this.bobY = this.moving && !getSettings().reducedMotion ? walkBobPx(time) : 0;
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
