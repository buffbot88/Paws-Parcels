import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene.ts";
import { PreloaderScene } from "../scenes/PreloaderScene.ts";
import { OverworldScene } from "../scenes/OverworldScene.ts";

/** Locked in design/decisions.md: 960x540 internal resolution. */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
/** Locked in design/decisions.md: 48x48 tile grid. */
export const TILE_SIZE = 48;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game-container",
  backgroundColor: "#bcd8a6",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloaderScene, OverworldScene],
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  render: {
    antialias: true,
    // Keep high-resolution village PNGs smooth when scaled in WebGL.
    mipmapFilter: "LINEAR",
    // The village pack is smooth 2.5D artwork, not pixel art. Preserve
    // fractional positions so scaled sprites and camera motion stay fluid.
    roundPixels: false,
  },
};
