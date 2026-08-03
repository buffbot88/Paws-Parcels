import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys } from "../game/GameConstants.ts";
import { TILES, TILESET_COLUMNS } from "../game/Tiles.ts";

/**
 * Preloader generates placeholder geometric textures at runtime (no binary
 * assets yet — BuildPlan: keep placeholders until Phase 4/8 art lands), shows
 * a loading bar, then starts the overworld.
 */
export class PreloaderScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Preloader);
  }

  create(): void {
    this.generatePlaceholderTextures();
    this.showLoadingBar();
    this.time.delayedCall(400, () => this.scene.start(SceneKeys.Overworld));
  }

  private generatePlaceholderTextures(): void {
    // Single tileset sheet: every tile type in src/game/Tiles.ts gets a frame
    // at its `index` — maps reference tiles by frame index (custom JSON maps).
    const cols = TILESET_COLUMNS;
    const sheetWidth = cols * TILE_SIZE;
    const sheetHeight = Math.ceil(TILES.length / cols) * TILE_SIZE;
    const g = this.make.graphics();
    for (const tile of TILES) {
      const fx = (tile.index % cols) * TILE_SIZE;
      const fy = Math.floor(tile.index / cols) * TILE_SIZE;
      g.fillStyle(tile.base, 1);
      g.fillRect(fx, fy, TILE_SIZE, TILE_SIZE);
      g.fillStyle(tile.edge, 1);
      g.fillRect(fx, fy, TILE_SIZE, 4);
      g.fillRect(fx, fy + TILE_SIZE - 4, TILE_SIZE, 4);
    }
    g.generateTexture(TextureKeys.TilesetMain, sheetWidth, sheetHeight);
    g.destroy();

    // Player placeholder: a simple rounded blob with eyes.
    const p = this.make.graphics();
    p.fillStyle(0xf2c94c, 1);
    p.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 4);
    p.fillStyle(0x2b2b2b, 1);
    p.fillCircle(TILE_SIZE / 2 - 7, TILE_SIZE / 2 - 4, 3);
    p.fillCircle(TILE_SIZE / 2 + 7, TILE_SIZE / 2 - 4, 3);
    p.generateTexture(TextureKeys.PlayerIdleDown, TILE_SIZE, TILE_SIZE);
    p.destroy();

    // Soft shadow ellipse that sits under the player.
    const s = this.make.graphics();
    s.fillStyle(0x000000, 0.25);
    s.fillEllipse(1, 6, 30, 12);
    s.generateTexture(TextureKeys.PlayerShadow, 32, 24);
    s.destroy();

    // NPC placeholder: white blob (tinted per NPC at runtime in NPC.ts).
    const n = this.make.graphics();
    n.fillStyle(0xffffff, 1);
    n.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 4);
    n.fillStyle(0x2b2b2b, 1);
    n.fillCircle(TILE_SIZE / 2 - 7, TILE_SIZE / 2 - 4, 3);
    n.fillCircle(TILE_SIZE / 2 + 7, TILE_SIZE / 2 - 4, 3);
    n.generateTexture(TextureKeys.NpcBlob, TILE_SIZE, TILE_SIZE);
    n.destroy();

    // Interactable-object marker: small rounded plaque.
    const o = this.make.graphics();
    o.fillStyle(0xffffff, 1);
    o.fillRoundedRect(2, 2, 26, 26, 6);
    o.generateTexture(TextureKeys.ObjectMarker, 30, 30);
    o.destroy();
  }

  private showLoadingBar(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(width / 2, height / 2, 240, 10, 0xffffff, 0.35)
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 24, "Preparing the forest…", {
        fontFamily: "Georgia, serif",
        fontSize: "18px",
        color: "#3a5a3a",
      })
      .setOrigin(0.5);
  }
}
