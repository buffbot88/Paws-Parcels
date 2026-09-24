import { HudModal } from "./HudModal.ts";
import { createKeyHint } from "./hud/primitives.ts";
import { TOUCH_HINTS, helpRows } from "../systems/keybindings.ts";

/** Keyboard help overlay (? / top-bar menu), generated from the shared bindings table. */
export class KeybindHelp {
  private readonly modal: HudModal;

  constructor(private readonly devAccess: () => boolean) {
    this.modal = new HudModal({
      className: "keybind-help",
      eyebrow: "COURIER HANDBOOK",
      title: "Keyboard help",
      toggleKey: "help",
      onOpen: () => this.render(),
    });
  }

  open(): void {
    this.modal.open();
  }

  destroy(): void {
    this.modal.destroy();
  }

  private render(): void {
    const table = document.createElement("dl");
    table.className = "keybind-help__list";
    for (const row of helpRows(this.devAccess())) {
      const term = document.createElement("dt");
      term.className = "keybind-help__keys";
      term.append(...row.caps.map((cap) => createKeyHint(cap)));
      const description = document.createElement("dd");
      description.textContent = row.label;
      table.append(term, description);
    }
    const touchHeading = document.createElement("h3");
    touchHeading.className = "keybind-help__heading";
    touchHeading.textContent = "Touch";
    const touch = document.createElement("ul");
    touch.className = "keybind-help__touch";
    for (const hint of TOUCH_HINTS) {
      const item = document.createElement("li");
      item.textContent = hint;
      touch.appendChild(item);
    }
    this.modal.body.replaceChildren(table, touchHeading, touch);
  }
}
