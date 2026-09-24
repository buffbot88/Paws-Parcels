/**
 * Fern's Salon: restyle a courier's look in a HUD dialog. The scene opens it
 * and persists the saved look; only one salon is open at a time.
 */
import type { Appearance } from "../game/appearance.ts";
import type { ClassKey } from "../game/classStats.ts";
import { AvatarEditor } from "./AvatarEditor.ts";
import { HudModal } from "./HudModal.ts";

export interface SalonOptions {
  classKey: ClassKey;
  appearance: unknown;
  onSave: (appearance: Appearance) => void;
}

let current: HudModal | null = null;

/** Save/cancel wiring, apart from the DOM so node tests cover it. */
export function salonActions(
  read: () => Appearance,
  onSave: (appearance: Appearance) => void,
  close: () => void,
): { save: () => void; cancel: () => void } {
  return {
    save: () => {
      onSave(read());
      close();
    },
    cancel: close,
  };
}

/** Open the salon; false when one is already open or another dialog is blocking it. */
export function openSalon(options: SalonOptions): boolean {
  if (current !== null) return false;
  const modal = new HudModal({
    className: "salon-panel",
    eyebrow: "CLOVER VILLAGE",
    title: "Fern's Salon",
    onClose: () => {
      editor.destroy();
      modal.destroy();
      current = null;
    },
  });
  current = modal;
  const editor = new AvatarEditor(modal.body, { classKey: options.classKey, appearance: options.appearance });
  const actions = salonActions(() => editor.getAppearance(), options.onSave, () => modal.close());

  const row = document.createElement("div");
  row.className = "salon-panel__actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "desk-btn desk-btn--primary";
  save.textContent = "Save look";
  save.addEventListener("click", actions.save);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "desk-btn desk-btn--text";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", actions.cancel);
  row.append(cancel, save);
  modal.body.appendChild(row);

  if (modal.open()) return true;
  editor.destroy();
  modal.destroy();
  current = null;
  return false;
}
