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
import { worldDepth } from "../game/WorldDepth.ts";

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

  readonly classKey: ClassKey;
  /** Movement speed (px/s) matching the server's class speed — see classAssets.ts. */
  readonly speed: number;
  facing: Facing = "down";
  private moving = false;
  private readonly attackCompleteHandler = (): void => this.playIdle();

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
    this.setScale(1.33);
    this.setDepth(worldDepth(this.y));
    this.playIfAvailable("idle", "south");
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
