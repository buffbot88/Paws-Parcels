import { createIcon } from "./hud/icons.ts";
import { hudLayer } from "./hud/layer.ts";

/**
 * HUD v4 inventory control (bottom-right): an icon-only circular button
 * carrying the courier's satchel. No label and no keycap chip — the whole
 * control is the glyph, and the key binding lives in its hover hint
 * ("Inventory - I") and its aria-label, the same way the minimap's toggle and
 * the skill bar's slots carry theirs.
 *
 * Opens the courier profile panel (Character tab by default), ready to expand
 * into a drawer later.
 */
export class InventoryButton {
  private readonly root: HTMLButtonElement;

  constructor(onOpen: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-button";
    button.setAttribute("aria-label", "Open inventory");
    button.title = "Inventory - I";

    button.append(createIcon("satchel", { size: 24, className: "inventory-button__icon" }));
    button.addEventListener("click", () => onOpen());
    hudLayer()?.appendChild(button);
    this.root = button;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  destroy(): void {
    this.root.remove();
  }
}
