import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { TextureKeys } from "../game/GameConstants.ts";
import type { NetMonsterInfo } from "../net/GameSocket.ts";
import { worldDepth } from "../game/WorldDepth.ts";

/** One cozy tint per species family (placeholder palette; art lands Phase 8). */
const SPECIES_TINTS: Readonly<Record<string, number>> = {
  "monster-wild-boar": 0x8a6a4a,
  "monster-valley-fox": 0xd97742,
  "monster-meadow-hare": 0xe8e0d0,
  "monster-forest-deer": 0xb08d57,
  "monster-black-grouse": 0x5a5a6a,
};

/** How quickly a monster eases toward its server target each frame. */
const LERP = 0.22;

/**
 * A monster in the world: tinted placeholder blob + name tag + tiny HP bar.
 * Positions come from server snapshots and are interpolated; HP bar reflects
 * authoritative combat events.
 */
export class Monster extends Phaser.GameObjects.Container {
  readonly id: string;
  readonly defKey: string;
  private targetX: number;
  private targetY: number;
  private nameTag: Phaser.GameObjects.Text;
  private hpBar: Phaser.GameObjects.Rectangle;
  private hpMax: number;

  constructor(scene: Phaser.Scene, info: NetMonsterInfo) {
    const px = info.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = info.pos.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.id = info.id;
    this.defKey = info.key;
    this.targetX = px;
    this.targetY = py;
    this.hpMax = info.maxHp || 1;

    const blob = scene.add
      .image(0, 0, TextureKeys.NpcBlob)
      .setTint(SPECIES_TINTS[info.key] ?? 0x777777)
      .setScale(1.1);
    const shadow = scene.add.image(0, 12, TextureKeys.PlayerShadow);
    this.nameTag = scene.add
      .text(0, -34, info.displayName, {
        fontFamily: "Georgia, serif",
        fontSize: "13px",
        color: "#4a2f2f",
        backgroundColor: "#ffffffcc",
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);

    // Tiny HP bar above the blob (authoritative width from the server).
    this.hpBar = scene.add
      .rectangle(0, -18, 36, 5, 0x66bb66)
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(1, 0xffffff, 0.8);

    this.add([shadow, blob, this.nameTag, this.hpBar]);
    this.setDepth(worldDepth(py));
    this.setHp(info.hp);
    scene.add.existing(this);
  }

  /** Update the interpolation target from a server snapshot (tile units). */
  setTarget(pos: { x: number; y: number }): void {
    this.targetX = pos.x * TILE_SIZE + TILE_SIZE / 2;
    this.targetY = pos.y * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Set authoritative HP and resize the bar. */
  setHp(hp: number): void {
    const ratio = Math.max(0, Math.min(1, hp / this.hpMax));
    this.hpBar.width = 36 * ratio;
    this.hpBar.fillColor = ratio > 0.5 ? 0x66bb66 : ratio > 0.25 ? 0xe0c040 : 0xd05050;
    this.hpBar.setVisible(this.hpMax > 0);
  }

  /** Ease toward the target; call every frame while the scene updates. */
  update(): void {
    this.x += (this.targetX - this.x) * LERP;
    this.y += (this.targetY - this.y) * LERP;
    this.setDepth(worldDepth(this.y));
    this.nameTag.setPosition(0, -34);
    this.hpBar.setPosition(0, -18);
  }

  /** Directly place (spawn teleport) without easing — used on join. */
  snapTo(pos: { x: number; y: number }): void {
    this.x = pos.x * TILE_SIZE + TILE_SIZE / 2;
    this.y = pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.targetX = this.x;
    this.targetY = this.y;
  }
}
