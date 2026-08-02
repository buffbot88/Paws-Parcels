import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys } from "../game/GameConstants.ts";

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
    const makeTile = (key: string, base: number, edge: number): void => {
      const g = this.make.graphics();
      g.fillStyle(base, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.fillStyle(edge, 1);
      g.fillRect(0, 0, TILE_SIZE, 4);
      g.fillRect(0, TILE_SIZE - 4, TILE_SIZE, 4);
      g.generateTexture(key, TILE_SIZE, TILE_SIZE);
      g.destroy();
    };
    makeTile(TextureKeys.TileGrass, 0x8fc98a, 0x77b573);
    makeTile(TextureKeys.TilePath, 0xd9b07c, 0xc29660);

    // Player placeholder: a simple rounded blob with eyes.
    const p = this.make.graphics();
    p.fillStyle(0xf2c94c, 1);
    p.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 4);
    p.fillStyle(0x2b2b2b, 1);
    p.fillCircle(TILE_SIZE / 2 - 7, TILE_SIZE / 2 - 4, 3);
    p.fillCircle(TILE_SIZE / 2 + 7, TILE_SIZE / 2 - 4, 3);
    p.generateTexture(TextureKeys.PlayerIdleDown, TILE_SIZE, TILE_SIZE);
    p.destroy();
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
