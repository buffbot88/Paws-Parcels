import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { TextureKeys } from "../game/GameConstants.ts";
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";

/** Placeholder palette — one distinct cozy color per NPC (Phase 8 replaces art). */
const NPC_TINTS: Readonly<Record<string, number>> = {
  "npc-pip": 0xf2a65a,
  "npc-maple": 0x8ab8a0,
  "npc-biscuit": 0xb0795a,
  "npc-lumi": 0x9a8fc0,
  "npc-moss": 0x7dbf6f,
};

/**
 * A static NPC: tinted placeholder blob + name tag + gentle bob tween.
 * Physics body is static so the player cannot walk through characters.
 */
export class NPC extends Phaser.Physics.Arcade.Sprite {
  readonly definition: NPCDefinition;

  constructor(scene: Phaser.Scene, definition: NPCDefinition) {
    const x = definition.homeTile.x * TILE_SIZE + TILE_SIZE / 2;
    const y = definition.homeTile.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, x, y, TextureKeys.NpcBlob);
    this.definition = definition;

    scene.add.existing(this);
    scene.physics.add.existing(this, true); // static body
    (this.body as Phaser.Physics.Arcade.StaticBody).setSize(30, 24);
    (this.body as Phaser.Physics.Arcade.StaticBody).setOffset(
      (TILE_SIZE - 30) / 2,
      TILE_SIZE - 24 - 4,
    );

    this.setTint(NPC_TINTS[definition.id] ?? 0xcccccc);
    this.setDepth(2);

    const name = scene.add
      .text(x, y - 30, definition.name, {
        fontFamily: "Georgia, serif",
        fontSize: "14px",
        color: "#3a5a3a",
        backgroundColor: "#ffffffcc",
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(3);

    // Gentle idle bob — cozy placeholder life (art/animation lands Phase 8).
    scene.tweens.add({
      targets: [this, name],
      y: "-=3",
      duration: 1400,
      ease: "sine.inout",
      yoyo: true,
      repeat: -1,
    });
  }
}
