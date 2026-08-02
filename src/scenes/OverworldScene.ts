import Phaser from "phaser";
import { GAME_WIDTH, GAME_HEIGHT, TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys } from "../game/GameConstants.ts";

/**
 * Phase 1 anchor scene: renders the loaded placeholder tileset + player sprite
 * to prove the asset pipeline works. Phase 2 replaces this with real maps,
 * collision, and movement.
 */
export class OverworldScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Overworld);
  }

  create(): void {
    // Placeholder tiled ground (grid of grass tiles).
    for (let y = 0; y < Math.ceil(GAME_HEIGHT / TILE_SIZE); y++) {
      for (let x = 0; x < Math.ceil(GAME_WIDTH / TILE_SIZE); x++) {
        this.add.image(x * TILE_SIZE, y * TILE_SIZE, TextureKeys.TileGrass).setOrigin(0);
      }
    }

    // A little dirt path across the middle.
    for (let x = 0; x < GAME_WIDTH / TILE_SIZE; x++) {
      this.add.image(x * TILE_SIZE, GAME_HEIGHT / 2 - TILE_SIZE / 2, TextureKeys.TilePath).setOrigin(0);
    }

    // Placeholder player in the center.
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, TextureKeys.PlayerIdleDown)
      .setDepth(1);

    this.add
      .text(GAME_WIDTH / 2, 24, "Paws & Parcels — Phase 1 foundation", {
        fontFamily: "Georgia, serif",
        fontSize: "20px",
        color: "#3a5a3a",
        backgroundColor: "#ffffff99",
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(10);
  }
}
