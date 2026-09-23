import { GAME_HEIGHT, GAME_WIDTH } from "../game/GameConfig.ts";
import { createIcon } from "./hud/icons.ts";
import { hudLayer } from "./hud/layer.ts";
import {
  COMPASS_SIZE_PX,
  clampToCanvas,
  compassArrowPoint,
  type CanvasFraction,
} from "./hud/questCompass.ts";

/**
 * The quest compass: a gold arrow floating just ahead of the courier, aimed at
 * the active quest's next destination, with the destination's name and the
 * remaining distance under it.
 *
 * It is a HUD element rather than a world object on purpose. The world is drawn
 * by two renderers — sprites and a 3D camera — and a marker that lives in the
 * world would have to be authored twice and would hide behind whatever it is
 * pointing through. As DOM, it only needs the two *projected* points, so both
 * renderers get identical guidance from one implementation, and it can never be
 * occluded by a tree.
 *
 * Positions arrive as fractions of the play area (0–1) and are published as
 * percentages, so the compass scales with the game window exactly like the rest
 * of the HUD; the offset and clamp are in the 960×540 internal canvas space.
 *
 * Decorative for assistive tech: it is a live pointer that would re-announce
 * every frame, and the tracker already carries the same instruction as text.
 */
export class QuestCompass {
  private readonly root: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly label: HTMLElement;
  private visible = false;
  private lastLabel = "";

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "quest-compass";
    this.root.className = "quest-compass";
    this.root.setAttribute("aria-hidden", "true");
    this.root.hidden = true;

    this.arrow = document.createElement("span");
    this.arrow.className = "quest-compass__arrow";
    this.arrow.appendChild(createIcon("navigation", { size: 20 }));

    this.label = document.createElement("span");
    this.label.className = "quest-compass__label";

    this.root.append(this.arrow, this.label);
    hudLayer()?.appendChild(this.root);
  }

  /**
   * Place and aim the arrow. `origin` is the courier's on-screen position as a
   * fraction of the play area, `angleRad` the bearing from the pure model, and
   * `label` its pre-formatted caption (empty when hidden).
   */
  update(view: {
    origin: CanvasFraction;
    label: string;
    angleRad: number;
    visible: boolean;
  }): void {
    if (!view.visible) {
      if (this.visible) {
        this.visible = false;
        this.root.hidden = true;
      }
      return;
    }

    const canvas = { width: GAME_WIDTH, height: GAME_HEIGHT };
    const ahead = compassArrowPoint(view.origin, view.angleRad, canvas);
    // Clamped with half the arrow's own box as the margin, so the arrow never
    // pokes its head out of the play area when the courier hugs an edge.
    const point = clampToCanvas(ahead, COMPASS_SIZE_PX / 2, canvas);

    this.root.style.left = `${point.x * 100}%`;
    this.root.style.top = `${point.y * 100}%`;
    // Rotation is the bearing itself: the icon is authored pointing right, and
    // the compass angle convention has 0 at east.
    this.root.style.setProperty("--compass-angle", `${view.angleRad}rad`);
    if (this.lastLabel !== view.label) {
      this.lastLabel = view.label;
      this.label.textContent = view.label;
    }
    if (!this.visible) {
      this.visible = true;
      this.root.hidden = false;
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
