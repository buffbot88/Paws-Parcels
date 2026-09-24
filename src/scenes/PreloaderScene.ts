import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { OBJECT_MARKER_SIZE_PX, SceneKeys, TextureKeys } from "../game/GameConstants.ts";
import { TILES, TILESET_COLUMNS } from "../game/Tiles.ts";
import { renderTilesetCanvas } from "../game/TileTextures.ts";
import { queueClassAssets, registerClassAnimations } from "../game/classAssets.ts";
import { queueCloverVillageAssets } from "../game/cloverVillageAssets.ts";
import { queueHappyValleyAssets } from "../game/happyValleyAssets.ts";
import {
  queueCloverVillageNpcAssets,
  registerCloverVillageNpcAnimations,
} from "../game/cloverVillageNpcAssets.ts";

/**
 * Preloader loads the selected class art and generates the remaining
 * placeholder textures at runtime, shows
 * a loading bar, then starts the overworld.
 */
export class PreloaderScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Preloader);
  }

  preload(): void {
    this.showLoadingBar();
    queueClassAssets(this);
    queueCloverVillageAssets(this);
    queueHappyValleyAssets(this);
    queueCloverVillageNpcAssets(this);
  }

  create(): void {
    registerClassAnimations(this);
    registerCloverVillageNpcAnimations(this);
    this.generatePlaceholderTextures();
    this.time.delayedCall(400, () => this.scene.start(SceneKeys.Overworld));
  }

  private generatePlaceholderTextures(): void {
    // Single tileset sheet: every tile type in src/game/Tiles.ts gets a frame
    // at its `index` — maps reference tiles by frame index (custom JSON maps).
    // Ground tiles now carry procedural textures (see TileTextures.ts).
    this.textures.addCanvas(
      TextureKeys.TilesetMain,
      renderTilesetCanvas(TILES, TILESET_COLUMNS),
    );

    // Player fallback: a simple rounded blob with eyes. Real class sprites
    // are loaded above; this texture keeps unknown/legacy class data safe.
    const p = this.make.graphics();
    p.fillStyle(0xf2c94c, 1);
    p.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 4);
    p.fillStyle(0x2b2b2b, 1);
    p.fillCircle(TILE_SIZE / 2 - 7, TILE_SIZE / 2 - 4, 3);
    p.fillCircle(TILE_SIZE / 2 + 7, TILE_SIZE / 2 - 4, 3);
    p.generateTexture(TextureKeys.PlayerIdleDown, TILE_SIZE, TILE_SIZE);
    p.destroy();

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
    const markerInset = 2;
    const markerSize = OBJECT_MARKER_SIZE_PX - markerInset * 2;
    o.fillRoundedRect(markerInset, markerInset, markerSize, markerSize, 6);
    o.generateTexture(TextureKeys.ObjectMarker, OBJECT_MARKER_SIZE_PX, OBJECT_MARKER_SIZE_PX);
    o.destroy();
  }

  /** Shown while the art downloads (tens of MB), so a slow link never looks frozen. */
  private showLoadingBar(): void {
    const { width, height } = this.scale;
    const barWidth = 240;
    this.add
      .rectangle(width / 2, height / 2, barWidth, 10, 0xffffff, 0.35)
      .setOrigin(0.5);
    const fill = this.add
      .rectangle(width / 2 - barWidth / 2, height / 2, 0, 10, 0x4f7a3f, 1)
      .setOrigin(0, 0.5);
    const label = this.add
      .text(width / 2, height / 2 - 24, "Preparing the forest… 0%", {
        fontFamily: "Georgia, serif",
        fontSize: "18px",
        color: "#3a5a3a",
      })
      .setOrigin(0.5);
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.width = barWidth * value;
      label.setText(`Preparing the forest… ${Math.round(value * 100)}%`);
    });
  }
}
