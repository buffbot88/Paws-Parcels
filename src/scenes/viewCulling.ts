/**
 * Draw only the static world near the camera.
 *
 * Phaser culls for input but not for drawing, and a zone is thousands of
 * static ground tiles, fringes, props and shadows of which about a tenth is on
 * screen. Their bounds never change, so they are measured once and each frame
 * only toggles visibility against the camera view plus a margin.
 */
import Phaser from "phaser";

export type Cullable = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Visible & { getBounds(): Phaser.Geom.Rectangle };

/** Drawn this far past the view edge so nothing pops in at the border of a fast pan. */
const MARGIN_PX = 96;

export class ViewCuller {
  private readonly items: { object: Cullable; bounds: Phaser.Geom.Rectangle }[];
  private readonly view = new Phaser.Geom.Rectangle();

  constructor(objects: readonly Cullable[]) {
    this.items = objects.map((object) => ({ object, bounds: object.getBounds() }));
  }

  update(worldView: Phaser.Geom.Rectangle): void {
    this.view.setTo(
      worldView.x - MARGIN_PX,
      worldView.y - MARGIN_PX,
      worldView.width + MARGIN_PX * 2,
      worldView.height + MARGIN_PX * 2,
    );
    for (const { object, bounds } of this.items) {
      object.setVisible(Phaser.Geom.Rectangle.Overlaps(this.view, bounds));
    }
  }
}
