/**
 * A loading bar driven by the scene loader, so a download on a slow link never
 * looks like a frozen game. Removes itself when the load completes.
 */
import Phaser from "phaser";

export function showLoadProgress(scene: Phaser.Scene, label: string): void {
  const { width, height } = scene.scale;
  const barWidth = 240;
  const track = scene.add.rectangle(width / 2, height / 2, barWidth, 10, 0xffffff, 0.35).setOrigin(0.5).setScrollFactor(0);
  const fill = scene.add
    .rectangle(width / 2 - barWidth / 2, height / 2, 0, 10, 0x4f7a3f, 1)
    .setOrigin(0, 0.5)
    .setScrollFactor(0);
  const text = scene.add
    .text(width / 2, height / 2 - 24, `${label} 0%`, { fontFamily: "Georgia, serif", fontSize: "18px", color: "#3a5a3a" })
    .setOrigin(0.5)
    .setScrollFactor(0);
  scene.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
    fill.width = barWidth * value;
    text.setText(`${label} ${Math.round(value * 100)}%`);
  });
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(Phaser.Loader.Events.PROGRESS);
    track.destroy();
    fill.destroy();
    text.destroy();
  });
}
