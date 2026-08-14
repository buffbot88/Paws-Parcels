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
import { worldDepth } from "../game/WorldDepth.ts";
import { PositionSampleBuffer } from "../net/positionInterpolation.ts";

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
  private facing: Facing = "south";

  constructor(scene: Phaser.Scene, info: NetPlayerInfo) {
    const px = info.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = info.pos.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.characterId = info.characterId;
    this.classKey = classKeyFromId(info.classKey === "cat-mage" ? 2 : info.classKey === "fox-archer" ? 3 : 1);
    this.samples.add({ at: Date.now(), x: px, y: py });

    const idleKey = animationKey(this.classKey, "idle", "south");
    this.sprite = scene.add
      .sprite(0, 0, scene.textures.exists(idleKey) ? idleKey : TextureKeys.NpcBlob)
      .setScale(1.33);
    const shadow = scene.add.image(0, 12, TextureKeys.PlayerShadow);
    this.nameTag = scene.add
      .text(0, -32, info.name, {
        fontFamily: "Georgia, serif",
        fontSize: "14px",
        color: "#3a5a3a",
        backgroundColor: "#ffffffcc",
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5);

    this.add([shadow, this.sprite, this.nameTag]);
    this.setDepth(worldDepth(py));
    scene.add.existing(this);
    this.playAnimation("idle", this.facing);
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
    this.nameTag.setPosition(0, -32);
    this.playAnimation(rendered.moving ? "walk" : "idle", this.facing);
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
    const key = animationKey(this.classKey, animation, direction as SpriteDirection);
    if (!this.scene.anims.exists(key)) return;
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) return;
    this.sprite.play(key);
  }
}
