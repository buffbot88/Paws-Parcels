import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { TextureKeys } from "../game/GameConstants.ts";
import type { NetPlayerInfo } from "../net/GameSocket.ts";

/** One cozy tint per class (placeholder palette; art lands Phase 8). */
const CLASS_TINTS: Readonly<Record<string, number>> = {
  "bear-warrior": 0xc88a5a,
  "cat-mage": 0x9a8fc0,
  "fox-archer": 0xe0a060,
};

/** How quickly a remote blob eases toward its server target each frame. */
const LERP = 0.22;

/**
 * A player controlled by someone else: tinted placeholder blob + name tag +
 * soft shadow. Positions come from server snapshots and are interpolated so
 * the tile-stepped authoritative positions render smoothly.
 */
export class RemotePlayer extends Phaser.GameObjects.Container {
  readonly characterId: number;
  readonly classKey: string;
  private targetX: number;
  private targetY: number;
  private nameTag: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, info: NetPlayerInfo) {
    const px = info.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = info.pos.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.characterId = info.characterId;
    this.classKey = info.classKey;
    this.targetX = px;
    this.targetY = py;

    const blob = scene.add
      .image(0, 0, TextureKeys.NpcBlob)
      .setTint(CLASS_TINTS[info.classKey] ?? 0xcccccc);
    const shadow = scene.add.image(0, 12, TextureKeys.PlayerShadow);
    this.nameTag = scene.add
      .text(0, -30, info.name, {
        fontFamily: "Georgia, serif",
        fontSize: "14px",
        color: "#3a5a3a",
        backgroundColor: "#ffffffcc",
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5);

    this.add([shadow, blob, this.nameTag]);
    this.setDepth(2);
    scene.add.existing(this);
  }

  /** Update the interpolation target from a server snapshot (tile units). */
  setTarget(pos: { x: number; y: number }): void {
    this.targetX = pos.x * TILE_SIZE + TILE_SIZE / 2;
    this.targetY = pos.y * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Ease toward the target; call every frame while the scene updates. */
  update(): void {
    this.x += (this.targetX - this.x) * LERP;
    this.y += (this.targetY - this.y) * LERP;
    // Keep the tag glued above the blob while it moves.
    this.nameTag.setPosition(0, -30);
  }

  /** Directly place (spawn teleport) without easing — used on join. */
  snapTo(pos: { x: number; y: number }): void {
    this.x = pos.x * TILE_SIZE + TILE_SIZE / 2;
    this.y = pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.targetX = this.x;
    this.targetY = this.y;
  }
}
