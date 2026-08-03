import Phaser from "phaser";
import { TextureKeys } from "../game/GameConstants.ts";
import type { MoveVector } from "../systems/InputSystem.ts";

export type Facing = "down" | "up" | "left" | "right";

/**
 * The player avatar: an Arcade physics sprite driven by the InputSystem's
 * normalized vector. Stores facing for future animation/frame work.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  static readonly SPEED = 180;
  /** Body smaller than a tile so squeezing between obstacles feels cozy. */
  static readonly BODY_WIDTH = 28;
  static readonly BODY_HEIGHT = 20;

  facing: Facing = "down";

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TextureKeys.PlayerIdleDown);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    (this.body as Phaser.Physics.Arcade.Body).setSize(
      Player.BODY_WIDTH,
      Player.BODY_HEIGHT,
    );
  }

  move(vector: MoveVector): void {
    this.setVelocity(vector.x * Player.SPEED, vector.y * Player.SPEED);
    if (vector.x === 0 && vector.y === 0) return;
    if (Math.abs(vector.x) >= Math.abs(vector.y)) {
      this.facing = vector.x < 0 ? "left" : "right";
    } else {
      this.facing = vector.y < 0 ? "up" : "down";
    }
  }
}
