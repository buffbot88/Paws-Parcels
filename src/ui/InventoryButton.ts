import { createIcon } from "./hud/icons.ts";
import { createKeyHint } from "./hud/primitives.ts";

/**
 * HUD v4 inventory control (bottom-right, ~235×72): warm cream button with a
 * backpack icon, "Inventory" label, and an inset `I` keycap. Opens the
 * courier profile panel (Character tab by default), ready to expand into a
 * drawer later.
 */
export class InventoryButton {
  private readonly root: HTMLButtonElement;

  constructor(onOpen: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-button";
    button.setAttribute("aria-label", "Open inventory");
    button.title = "Inventory (I)";

    const icon = createIcon("backpack", { size: 22, className: "inventory-button__icon" });
    const label = document.createElement("span");
    label.className = "inventory-button__label";
    label.textContent = "Inventory";
    const key = createKeyHint("I");

    button.append(icon, label, key);
    button.addEventListener("click", () => onOpen());
    document.getElementById("game-container")?.appendChild(button);
    this.root = button;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  destroy(): void {
    this.root.remove();
  }
}
