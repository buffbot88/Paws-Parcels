import { HudModal } from "./HudModal.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { sfx } from "../audio/sfx.ts";

/** Local preferences dialog (top-bar menu); every control applies immediately. */
export class SettingsPanel {
  private readonly modal: HudModal;
  private readonly sound: HTMLInputElement;
  private readonly volume: HTMLInputElement;
  private readonly damageNumbers: HTMLInputElement;
  private readonly quality: HTMLSelectElement;
  private readonly reducedMotion: HTMLInputElement;

  constructor() {
    this.modal = new HudModal({
      className: "settings-panel",
      eyebrow: "COURIER PREFERENCES",
      title: "Settings",
      onOpen: () => this.sync(),
    });

    this.sound = checkbox();
    this.sound.addEventListener("change", () => sfx.setMuted(!this.sound.checked));
    this.volume = document.createElement("input");
    this.volume.type = "range";
    this.volume.min = "0";
    this.volume.max = "100";
    this.volume.step = "5";
    this.volume.addEventListener("input", () => {
      updateSettings({ sfxVolume: Number(this.volume.value) / 100 });
      this.volume.setAttribute("aria-valuetext", `${this.volume.value}%`);
    });
    // Play the chime once the slider is released so the new level can be heard.
    this.volume.addEventListener("change", () => sfx.playProgression("level"));
    this.damageNumbers = checkbox();
    this.damageNumbers.addEventListener("change", () => updateSettings({ damageNumbers: this.damageNumbers.checked }));
    this.quality = document.createElement("select");
    for (const [value, label] of [["high", "High"], ["low", "Low"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.quality.appendChild(option);
    }
    this.quality.addEventListener("change", () => updateSettings({ graphicsQuality: this.quality.value === "low" ? "low" : "high" }));
    this.reducedMotion = checkbox();
    this.reducedMotion.addEventListener("change", () => updateSettings({ reducedMotion: this.reducedMotion.checked }));

    this.modal.body.append(
      row("Sound effects", this.sound),
      row("Sound volume", this.volume),
      row("Damage numbers", this.damageNumbers),
      row("Graphics quality", this.quality),
      row("Reduce motion", this.reducedMotion),
    );
  }

  open(): void {
    this.modal.open();
  }

  destroy(): void {
    this.modal.destroy();
  }

  private sync(): void {
    const settings = getSettings();
    this.sound.checked = !sfx.isMuted();
    this.volume.value = String(Math.round(settings.sfxVolume * 100));
    this.volume.setAttribute("aria-valuetext", `${this.volume.value}%`);
    this.damageNumbers.checked = settings.damageNumbers;
    this.quality.value = settings.graphicsQuality;
    this.reducedMotion.checked = settings.reducedMotion;
  }
}

function checkbox(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  return input;
}

function row(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "settings-panel__row";
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(text, control);
  return wrapper;
}
