/**
 * The 2D world's ambient motes: the same per-zone fireflies and pollen as the
 * 3D world (`game/atmosphere.ts`), drawn as a small pool of additive dots.
 *
 * Decoration only, so it follows the same switches as the 3D motes: off for
 * `graphicsQuality: "low"` and for reduced motion.
 */
import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { ambientPoint, zoneAtmosphere, type AmbientStyle } from "../game/atmosphere.ts";
import { getSettings, onSettingsChange } from "../ui/settings.ts";

const DOT_KEY = "ambient-dot";
const DOT_PX = 16;
/** Above the world and its foreground canopy; the HUD is DOM, so nothing else is higher. */
const MOTE_DEPTH = 1000;

function ensureDotTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(DOT_KEY)) return;
  const g = scene.add.graphics();
  const centre = DOT_PX / 2;
  g.fillStyle(0xffffff, 0.2).fillCircle(centre, centre, centre);
  g.fillStyle(0xffffff, 0.45).fillCircle(centre, centre, centre * 0.6);
  g.fillStyle(0xffffff, 1).fillCircle(centre, centre, centre * 0.3);
  g.generateTexture(DOT_KEY, DOT_PX, DOT_PX);
  g.destroy();
}

export class AmbientMotes2D {
  private readonly style: AmbientStyle;
  private readonly dots: Phaser.GameObjects.Image[] = [];
  private readonly unsubscribe: () => void;
  private enabled = false;

  constructor(scene: Phaser.Scene, zoneId: string) {
    this.style = zoneAtmosphere(zoneId).ambient;
    ensureDotTexture(scene);
    const scale = (this.style.sizeTiles * TILE_SIZE) / (DOT_PX * 0.6);
    for (let i = 0; i < this.style.count; i++) {
      this.dots.push(
        scene.add
          .image(0, 0, DOT_KEY)
          .setTint(this.style.colour)
          .setScale(scale)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(MOTE_DEPTH),
      );
    }
    this.applySettings();
    this.unsubscribe = onSettingsChange(() => this.applySettings());
  }

  /** Step every mote around the courier (`focus`, in tiles). */
  update(timeSeconds: number, focus: { x: number; y: number }): void {
    if (!this.enabled) return;
    this.dots.forEach((dot, index) => {
      const point = ambientPoint(this.style, index, timeSeconds, { x: focus.x, z: focus.y });
      // Top-down: height above the ground lifts the mote up the screen.
      dot.setPosition(point.x * TILE_SIZE, (point.z - point.y) * TILE_SIZE).setAlpha(point.glow);
    });
  }

  destroy(): void {
    this.unsubscribe();
    for (const dot of this.dots) dot.destroy();
    this.dots.length = 0;
  }

  private applySettings(): void {
    const settings = getSettings();
    this.enabled = settings.graphicsQuality !== "low" && !settings.reducedMotion;
    for (const dot of this.dots) dot.setVisible(this.enabled);
  }
}
