import Phaser from "phaser";
import { SceneKeys } from "../game/GameConstants.ts";

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    console.info(`[Boot] Paws & Parcels — Phaser ${Phaser.VERSION}`);
    this.scene.start(SceneKeys.Preloader);
  }
}
